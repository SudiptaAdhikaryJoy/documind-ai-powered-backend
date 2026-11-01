import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { EmailTemplates } from '../mail/templates/email-templates';
import { SmsService } from '../sms/sms.service';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
const MAX_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
  ) {}

  /**
   * Generates, stores, and dispatches an OTP to email or phone.
   */
  async createAndSendOtp(
    target: string,
    purpose: OtpPurpose,
    purposeDescription: string,
  ): Promise<{ success: boolean; message: string; cooldownSeconds: number }> {
    const normalizedTarget = target.trim().toLowerCase();

    // 1. Check rate limit / cooldown
    const recent = await this.prisma.otp.findFirst({
      where: {
        target: normalizedTarget,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recent) {
      const elapsed = Date.now() - recent.createdAt.getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const remaining = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        throw new BadRequestException(
          `Please wait ${remaining} seconds before requesting a new code.`,
        );
      }
    }

    // 2. Invalidate previous unconsumed OTPs for this target & purpose
    await this.prisma.otp.updateMany({
      where: {
        target: normalizedTarget,
        purpose,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    // 3. Generate secure 6-digit code
    const rawCode = randomInt(100000, 1000000).toString();
    const codeHash = sha256(rawCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // 4. Save to database
    await this.prisma.otp.create({
      data: {
        target: normalizedTarget,
        codeHash,
        purpose,
        maxAttempts: MAX_ATTEMPTS,
        expiresAt,
      },
    });

    // 5. Dispatch via Mail or SMS
    const isEmail = normalizedTarget.includes('@');
    if (isEmail) {
      const { subject, html, text } = EmailTemplates.otpTemplate(
        rawCode,
        purposeDescription,
      );
      await this.mail.send({
        to: normalizedTarget,
        subject,
        html,
        text,
      });
    } else {
      const smsMessage = `Your DocuMind AI code for ${purposeDescription} is: ${rawCode} (valid for 10 min).`;
      await this.sms.send({
        to: normalizedTarget,
        message: smsMessage,
      });
    }

    this.logger.log(
      `OTP created for ${normalizedTarget} [${purpose}] (expires in 10m)`,
    );

    return {
      success: true,
      message: `Verification code sent to ${normalizedTarget}`,
      cooldownSeconds: 60,
    };
  }

  /**
   * Verifies and marks an OTP as consumed.
   */
  async verifyOtp(
    target: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<{ verified: boolean }> {
    const normalizedTarget = target.trim().toLowerCase();
    const cleanCode = code.trim();

    const record = await this.prisma.otp.findFirst({
      where: {
        target: normalizedTarget,
        purpose,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new UnauthorizedException(
        'No active verification code found for this request. Please request a new code.',
      );
    }

    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'Verification code has expired. Please request a new code.',
      );
    }

    if (record.attempts >= record.maxAttempts) {
      await this.prisma.otp.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Too many failed attempts. This code is now invalidated. Please request a new code.',
      );
    }

    const inputHash = sha256(cleanCode);
    if (inputHash !== record.codeHash) {
      await this.prisma.otp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = record.maxAttempts - (record.attempts + 1);
      throw new UnauthorizedException(
        `Invalid code. ${remaining} attempt(s) remaining.`,
      );
    }

    // Success: atomically consume code
    await this.prisma.otp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return { verified: true };
  }
}
