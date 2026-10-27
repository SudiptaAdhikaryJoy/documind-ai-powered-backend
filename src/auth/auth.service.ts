import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  private readonly refreshDays = Number(process.env.REFRESH_TTL_DAYS ?? 7);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const password = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: dto.email, password, name: dto.name, phone: dto.phone },
      });
      const workspace = await tx.workspace.create({ data: { name: dto.workspaceName } });
      await tx.membership.create({
        data: { userId: created.id, workspaceId: workspace.id, role: 'OWNER' },
      });
      return created;
    });

    return this.issuePair(user, 'User register successfully');
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

    return {
      statusCode: 200,
      message: "Token refreshed successfully",
      data: {
        accessToken: await this.signAccess(stored.userId, stored.user.email),
        refreshToken: token,
      }
    };
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
    return {
      statusCode: 201,
      message,
      data: {
        userName: name,
        email: email,
        id: userId,
        phone: phone,
        accessToken: await this.signAccess(userId, email),
        refreshToken: token,
      }
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