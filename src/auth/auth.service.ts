import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpPurpose } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  ForgotPasswordDto,
  LoginDto,
  PhoneLoginRequestDto,
  PhoneLoginVerifyDto,
  RegisterDto,
  ResendOtpDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto';
import { OtpService } from '../communication/otp/otp.service';
import { NotificationService } from '../communication/notification/notification.service';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly refreshDays = Number(process.env.REFRESH_TTL_DAYS ?? 7);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly notifications: NotificationService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.email }, { phone: dto.phone }],
      },
    });
    if (existing) {
      if (existing.email === dto.email) {
        throw new ConflictException('Email already registered');
      }
      throw new ConflictException('Phone number already registered');
    }

    const password = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          password,
          name: dto.name,
          phone: dto.phone,
          isEmailVerified: false,
          isPhoneVerified: false,
        },
      });
      const workspace = await tx.workspace.create({
        data: { name: dto.workspaceName },
      });
      await tx.membership.create({
        data: {
          userId: created.id,
          workspaceId: workspace.id,
          memberName: created.name,
          workspaceName: workspace.name,
          role: 'OWNER',
        },
      });
      return created;
    });

    // Send verification OTP to both email and phone asynchronously
    void this.otp
      .createAndSendOtp(
        user.email,
        OtpPurpose.SIGNUP_EMAIL_VERIFICATION,
        'Email Verification',
      )
      .catch(() => undefined);

    void this.otp
      .createAndSendOtp(
        user.phone,
        OtpPurpose.SIGNUP_PHONE_VERIFICATION,
        'Phone Verification',
      )
      .catch(() => undefined);

    return this.issuePair(user, 'User registered successfully. Verification codes have been sent.');
  }

  async login(dto: LoginDto) {
    // Email or phone; if both are sent they must belong to the same user.
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, phone: dto.phone },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issuePair(user, 'User logged in successfully');
  }

  async refresh(presented: string) {
    const tokenHash = sha256(presented);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    // Reuse detection: an already-revoked token means it was stolen and
    // replayed. Kill every session for that user.
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // Trigger instant high-priority security alert email
      void this.notifications.notifyTokenReuseAlert(stored.user.email).catch(() => undefined);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Rotate: the presented token dies as the new one is born.
    const { token, hash, expiresAt } = this.mintRefresh();
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: { userId: stored.userId, tokenHash: hash, expiresAt },
      }),
    ]);

    const accessToken = await this.signAccess(stored.userId, stored.user.email);
    return {
      statusCode: 200,
      message: 'Token refreshed successfully',
      data: {
        accessToken,
        refreshToken: token,
      },
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    await this.otp.verifyOtp(dto.target, dto.code, dto.purpose);

    // Update verified flags if signup verification
    if (dto.purpose === OtpPurpose.SIGNUP_EMAIL_VERIFICATION) {
      await this.prisma.user.updateMany({
        where: { email: dto.target.trim().toLowerCase() },
        data: { isEmailVerified: true },
      });
    } else if (dto.purpose === OtpPurpose.SIGNUP_PHONE_VERIFICATION) {
      await this.prisma.user.updateMany({
        where: { phone: dto.target.trim() },
        data: { isPhoneVerified: true },
      });
    }

    return {
      statusCode: 200,
      message: 'Verification successful',
      data: { verified: true },
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const isEmail = dto.target.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail
        ? { email: dto.target.trim().toLowerCase() }
        : { phone: dto.target.trim() },
    });

    if (!user) {
      throw new NotFoundException('No user found with the provided email or phone');
    }

    let purposeDesc = 'Verification';
    if (dto.purpose === OtpPurpose.SIGNUP_EMAIL_VERIFICATION) purposeDesc = 'Email Verification';
    else if (dto.purpose === OtpPurpose.SIGNUP_PHONE_VERIFICATION) purposeDesc = 'Phone Verification';
    else if (dto.purpose === OtpPurpose.PASSWORD_RESET) purposeDesc = 'Password Reset';
    else if (dto.purpose === OtpPurpose.PHONE_LOGIN) purposeDesc = 'Phone Login';
    else if (dto.purpose === OtpPurpose.STEP_UP_ACTION) purposeDesc = 'Security Confirmation';

    const result = await this.otp.createAndSendOtp(dto.target, dto.purpose, purposeDesc);
    return {
      statusCode: 200,
      message: result.message,
      data: { cooldownSeconds: result.cooldownSeconds },
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const isEmail = dto.target.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail
        ? { email: dto.target.trim().toLowerCase() }
        : { phone: dto.target.trim() },
    });

    // To prevent account enumeration in production, we still return 200 if not found,
    // but in development we can be helpful or simply proceed.
    if (!user) {
      return {
        statusCode: 200,
        message: 'If an account exists with this credential, a password reset code has been sent.',
      };
    }

    await this.otp.createAndSendOtp(
      dto.target,
      OtpPurpose.PASSWORD_RESET,
      'Password Reset',
    );

    return {
      statusCode: 200,
      message: 'Password reset code has been sent successfully.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    // 1. Verify OTP
    await this.otp.verifyOtp(dto.target, dto.code, OtpPurpose.PASSWORD_RESET);

    const isEmail = dto.target.includes('@');
    const user = await this.prisma.user.findFirst({
      where: isEmail
        ? { email: dto.target.trim().toLowerCase() }
        : { phone: dto.target.trim() },
    });

    if (!user) {
      throw new NotFoundException('User account not found');
    }

    // 2. Hash and update password
    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // 3. Invalidate all active sessions for security
    await this.logoutAll(user.id);

    return {
      statusCode: 200,
      message: 'Password has been reset successfully. Please log in with your new password.',
    };
  }

  async requestPhoneLogin(dto: PhoneLoginRequestDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone.trim() },
    });

    if (!user) {
      throw new NotFoundException('No account found with this phone number');
    }

    const result = await this.otp.createAndSendOtp(
      dto.phone,
      OtpPurpose.PHONE_LOGIN,
      'Phone Login',
    );

    return {
      statusCode: 200,
      message: 'One-time login code sent to your phone',
      data: { cooldownSeconds: result.cooldownSeconds },
    };
  }

  async verifyPhoneLogin(dto: PhoneLoginVerifyDto) {
    await this.otp.verifyOtp(dto.phone, dto.code, OtpPurpose.PHONE_LOGIN);

    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone.trim() },
    });

    if (!user) {
      throw new NotFoundException('User account not found');
    }

    return this.issuePair(user, 'Logged in successfully with phone OTP');
  }

  async logout(presented: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(presented), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private async issuePair(
    user: { id: string; email: string; name: string; phone: string },
    message: string,
  ) {
    const { id: userId, email, name, phone } = user;
    const { token, hash, expiresAt } = this.mintRefresh();
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hash, expiresAt },
    });
    const accessToken = await this.signAccess(userId, email);
    return {
      statusCode: 201,
      message,
      data: {
        userName: name,
        email: email,
        id: userId,
        phone: phone,
        accessToken,
        refreshToken: token,
      },
    };
  }

  private signAccess(sub: string, email: string) {
    return this.jwt.signAsync({ sub, email });
  }

  private mintRefresh() {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshDays * 86_400_000);
    return { token, hash: sha256(token), expiresAt };
  }
}
