import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { createHash } from 'crypto';
import { OtpService } from './otp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';

const sha256 = (val: string) => createHash('sha256').update(val).digest('hex');

describe('OtpService', () => {
  let service: OtpService;
  let mockPrisma: any;
  let mockMail: any;
  let mockSms: any;

  beforeEach(() => {
    mockPrisma = {
      otp: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    mockMail = {
      send: jest.fn().mockResolvedValue({ messageId: 'test-mail-id' }),
    };
    mockSms = {
      send: jest.fn().mockResolvedValue({ messageId: 'test-sms-id' }),
    };

    service = new OtpService(
      mockPrisma as unknown as PrismaService,
      mockMail as unknown as MailService,
      mockSms as unknown as SmsService,
    );
  });

  describe('createAndSendOtp', () => {
    it('generates a 6-digit code and dispatches email for email targets', async () => {
      mockPrisma.otp.findFirst.mockResolvedValue(null);
      mockPrisma.otp.create.mockResolvedValue({ id: 'otp-1' });

      const res = await service.createAndSendOtp(
        'user@example.com',
        OtpPurpose.SIGNUP_EMAIL_VERIFICATION,
        'Email Verification',
      );

      expect(res.success).toBe(true);
      expect(mockPrisma.otp.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          target: 'user@example.com',
          purpose: OtpPurpose.SIGNUP_EMAIL_VERIFICATION,
          maxAttempts: 5,
        }),
      });
      expect(mockMail.send).toHaveBeenCalledTimes(1);
      expect(mockMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
        }),
      );
      expect(mockSms.send).not.toHaveBeenCalled();
    });

    it('generates a 6-digit code and dispatches SMS for phone targets', async () => {
      mockPrisma.otp.findFirst.mockResolvedValue(null);
      mockPrisma.otp.create.mockResolvedValue({ id: 'otp-2' });

      const res = await service.createAndSendOtp(
        '01712345678',
        OtpPurpose.PHONE_LOGIN,
        'Phone Login',
      );

      expect(res.success).toBe(true);
      expect(mockSms.send).toHaveBeenCalledTimes(1);
      expect(mockSms.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '01712345678',
          message: expect.stringContaining('Phone Login'),
        }),
      );
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('enforces 60-second cooldown rate limit', async () => {
      mockPrisma.otp.findFirst.mockResolvedValue({
        id: 'recent-otp',
        createdAt: new Date(Date.now() - 30 * 1000), // 30s ago
      });

      await expect(
        service.createAndSendOtp(
          'user@example.com',
          OtpPurpose.PASSWORD_RESET,
          'Password Reset',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyOtp', () => {
    it('successfully verifies correct OTP and consumes it', async () => {
      const plainCode = '482910';
      mockPrisma.otp.findFirst.mockResolvedValue({
        id: 'otp-123',
        codeHash: sha256(plainCode),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
        maxAttempts: 5,
      });

      const res = await service.verifyOtp(
        'user@example.com',
        plainCode,
        OtpPurpose.PASSWORD_RESET,
      );

      expect(res.verified).toBe(true);
      expect(mockPrisma.otp.update).toHaveBeenCalledWith({
        where: { id: 'otp-123' },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('throws UnauthorizedException and increments attempts on incorrect code', async () => {
      mockPrisma.otp.findFirst.mockResolvedValue({
        id: 'otp-123',
        codeHash: sha256('654321'),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 1,
        maxAttempts: 5,
      });

      await expect(
        service.verifyOtp('user@example.com', '111111', OtpPurpose.PASSWORD_RESET),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.otp.update).toHaveBeenCalledWith({
        where: { id: 'otp-123' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('throws UnauthorizedException if code has expired', async () => {
      mockPrisma.otp.findFirst.mockResolvedValue({
        id: 'otp-expired',
        codeHash: sha256('123456'),
        expiresAt: new Date(Date.now() - 1000), // expired 1s ago
        attempts: 0,
        maxAttempts: 5,
      });

      await expect(
        service.verifyOtp('user@example.com', '123456', OtpPurpose.PASSWORD_RESET),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('invalidates and rejects code when max attempts are exceeded', async () => {
      mockPrisma.otp.findFirst.mockResolvedValue({
        id: 'otp-locked',
        codeHash: sha256('123456'),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 5,
        maxAttempts: 5,
      });

      await expect(
        service.verifyOtp('user@example.com', '123456', OtpPurpose.PASSWORD_RESET),
      ).rejects.toThrow('Too many failed attempts');

      expect(mockPrisma.otp.update).toHaveBeenCalledWith({
        where: { id: 'otp-locked' },
        data: { consumedAt: expect.any(Date) },
      });
    });
  });
});
