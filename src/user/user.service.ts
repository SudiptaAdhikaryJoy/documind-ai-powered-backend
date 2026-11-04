import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../communication/otp/otp.service';
import { R2Service } from './r2.service';
import {
  AvatarUploadUrlRequestDto,
  ConfirmAvatarDto,
  UpdatePasswordDto,
  UpdateProfileDto,
  UserProfileDto,
} from './dto/user.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly r2Service: R2Service,
  ) {}

  /**
   * Retrieves the full profile of the authenticated user
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        members: {
          include: {
            workspace: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    const data: UserProfileDto = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      isEmailVerified: user.isEmailVerified,
      isPhoneVerified: user.isPhoneVerified,
      createdAt: user.createdAt,
      workspaces: user.members.map((m) => ({
        workspaceId: m.workspaceId,
        workspaceName: m.workspace.name,
        role: m.role,
        plan: m.workspace.plan,
        joinedAt: m.createdAt,
      })),
    };

    return {
      statusCode: 200,
      message: 'User profile retrieved successfully',
      data,
    };
  }

  /**
   * Updates user profile fields (name, email, phone, avatarUrl)
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (
      dto.name === undefined &&
      dto.email === undefined &&
      dto.phone === undefined &&
      dto.avatarUrl === undefined
    ) {
      throw new BadRequestException(
        'At least one field (name, email, phone, or avatarUrl) must be provided for update',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updateData: {
      name?: string;
      email?: string;
      phone?: string;
      avatarUrl?: string;
      isEmailVerified?: boolean;
      isPhoneVerified?: boolean;
    } = {};

    let emailChanged = false;
    let phoneChanged = false;

    // Validate email if provided
    if (dto.email !== undefined) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      if (normalizedEmail !== user.email.toLowerCase()) {
        const existing = await this.prisma.user.findFirst({
          where: {
            email: normalizedEmail,
            NOT: { id: userId },
          },
        });
        if (existing) {
          throw new ConflictException('Email already registered by another account');
        }
        updateData.email = normalizedEmail;
        updateData.isEmailVerified = false;
        emailChanged = true;
      }
    }

    // Validate phone if provided
    if (dto.phone !== undefined) {
      const normalizedPhone = dto.phone.trim();
      if (normalizedPhone !== user.phone) {
        const existing = await this.prisma.user.findFirst({
          where: {
            phone: normalizedPhone,
            NOT: { id: userId },
          },
        });
        if (existing) {
          throw new ConflictException('Phone number already registered by another account');
        }
        updateData.phone = normalizedPhone;
        updateData.isPhoneVerified = false;
        phoneChanged = true;
      }
    }

    // Validate name if provided
    const nameChanged = dto.name !== undefined && dto.name.trim() !== user.name;
    if (dto.name !== undefined) {
      updateData.name = dto.name.trim();
    }

    // Validate avatarUrl if provided
    if (dto.avatarUrl !== undefined) {
      updateData.avatarUrl = dto.avatarUrl.trim();
    }

    // Atomic update in Prisma
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: updateData,
        include: {
          members: {
            include: {
              workspace: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      // Synchronize compound relation field memberName if name changed
      if (nameChanged && dto.name) {
        await tx.membership.updateMany({
          where: { userId },
          data: { memberName: dto.name.trim() },
        });
      }

      return updated;
    });

    // Send verification OTP if email changed
    if (emailChanged && updateData.email) {
      void this.otpService
        .createAndSendOtp(
          updateData.email,
          OtpPurpose.SIGNUP_EMAIL_VERIFICATION,
          'Email Verification',
        )
        .catch((err) =>
          this.logger.error(`Failed to send verification code to updated email: ${(err as Error).message}`),
        );
    }

    // Send verification OTP if phone changed
    if (phoneChanged && updateData.phone) {
      void this.otpService
        .createAndSendOtp(
          updateData.phone,
          OtpPurpose.SIGNUP_PHONE_VERIFICATION,
          'Phone Verification',
        )
        .catch((err) =>
          this.logger.error(`Failed to send verification code to updated phone: ${(err as Error).message}`),
        );
    }

    const data: UserProfileDto = {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      avatarUrl: updatedUser.avatarUrl,
      isEmailVerified: updatedUser.isEmailVerified,
      isPhoneVerified: updatedUser.isPhoneVerified,
      createdAt: updatedUser.createdAt,
      workspaces: updatedUser.members.map((m) => ({
        workspaceId: m.workspaceId,
        workspaceName: m.workspace.name,
        role: m.role,
        plan: m.workspace.plan,
        joinedAt: m.createdAt,
      })),
    };

    let msg = 'Profile updated successfully.';
    if (emailChanged && phoneChanged) {
      msg += ' Verification codes sent to your new email and phone.';
    } else if (emailChanged) {
      msg += ' A verification code has been sent to your new email.';
    } else if (phoneChanged) {
      msg += ' A verification code has been sent to your new phone number.';
    }

    return {
      statusCode: 200,
      message: msg,
      data,
    };
  }

  /**
   * Updates user password with current password verification
   */
  async updatePassword(userId: string, dto: UpdatePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Current password does not match');
    }

    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('New password cannot be identical to current password');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });

      if (dto.revokeOtherSessions !== false) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    return {
      statusCode: 200,
      message: 'Password updated successfully. Other active sessions have been invalidated.',
    };
  }

  /**
   * Generates a presigned PUT URL for Cloudflare R2 direct browser upload
   */
  async createAvatarUploadUrl(userId: string, dto: AvatarUploadUrlRequestDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.fileSize && dto.fileSize > 10 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds the 10MB limit');
    }

    const result = await this.r2Service.createPresignedUploadUrl({
      userId,
      filename: dto.filename,
      contentType: dto.contentType ?? 'image/jpeg',
    });

    return {
      statusCode: 200,
      message: 'Presigned upload URL generated successfully',
      data: result,
    };
  }

  /**
   * Confirms profile photo upload and saves avatarUrl into PostgreSQL
   */
  async confirmAvatar(userId: string, dto: ConfirmAvatarDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: dto.avatarUrl.trim() },
      include: {
        members: {
          include: {
            workspace: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const data: UserProfileDto = {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      avatarUrl: updatedUser.avatarUrl,
      isEmailVerified: updatedUser.isEmailVerified,
      isPhoneVerified: updatedUser.isPhoneVerified,
      createdAt: updatedUser.createdAt,
      workspaces: updatedUser.members.map((m) => ({
        workspaceId: m.workspaceId,
        workspaceName: m.workspace.name,
        role: m.role,
        plan: m.workspace.plan,
        joinedAt: m.createdAt,
      })),
    };

    return {
      statusCode: 200,
      message: 'Profile photo updated successfully',
      data,
    };
  }

  /**
   * Removes profile photo from database and Cloudflare R2
   */
  async deleteAvatar(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.avatarUrl) {
      return {
        statusCode: 200,
        message: 'No profile photo to remove',
      };
    }

    // Attempt to extract key from avatarUrl and delete from R2
    const avatarUrl = user.avatarUrl;
    const match = avatarUrl.match(/(avatars\/[^?#]+)/);
    if (match) {
      void this.r2Service.deleteObject(match[1]).catch((err) => {
        this.logger.warn(`Failed to delete object from R2: ${(err as Error).message}`);
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });

    return {
      statusCode: 200,
      message: 'Profile photo removed successfully',
    };
  }

  /**
   * Handles Cloudflare R2 Event Notification webhooks to automatically sync upload links to DB
   */
  async handleR2Webhook(payload: Record<string, unknown>, secretHeader?: string) {
    if (!this.r2Service.verifyWebhookSecret(secretHeader)) {
      throw new UnauthorizedException('Invalid or missing webhook secret');
    }

    const parsed = this.r2Service.parseWebhookNotification(payload);
    if (!parsed) {
      return {
        statusCode: 200,
        message: 'Ignored non-avatar event notification',
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: parsed.userId },
    });

    if (!user) {
      this.logger.warn(`Webhook received for non-existent user: ${parsed.userId}`);
      return {
        statusCode: 200,
        message: `User ${parsed.userId} not found`,
      };
    }

    await this.prisma.user.update({
      where: { id: parsed.userId },
      data: { avatarUrl: parsed.publicUrl },
    });

    this.logger.log(`Automatically updated avatarUrl for user ${parsed.userId} via Cloudflare R2 webhook`);

    return {
      statusCode: 200,
      message: 'Avatar updated from Cloudflare R2 webhook successfully',
      data: {
        userId: parsed.userId,
        avatarUrl: parsed.publicUrl,
      },
    };
  }

  /**
   * Requests a new email verification code
   */
  async requestEmailVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified) throw new BadRequestException('Email is already verified');

    const result = await this.otpService.createAndSendOtp(
      user.email,
      OtpPurpose.SIGNUP_EMAIL_VERIFICATION,
      'Email Verification',
    );

    return {
      statusCode: 200,
      message: result.message,
      data: { cooldownSeconds: result.cooldownSeconds },
    };
  }

  /**
   * Requests a new phone verification code
   */
  async requestPhoneVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.isPhoneVerified) throw new BadRequestException('Phone number is already verified');

    const result = await this.otpService.createAndSendOtp(
      user.phone,
      OtpPurpose.SIGNUP_PHONE_VERIFICATION,
      'Phone Verification',
    );

    return {
      statusCode: 200,
      message: result.message,
      data: { cooldownSeconds: result.cooldownSeconds },
    };
  }
}
