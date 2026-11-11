import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OtpPurpose } from '@prisma/client';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../communication/otp/otp.service';
import { NotificationService } from '../communication/notification/notification.service';

const sha256 = (val: string) => createHash('sha256').update(val).digest('hex');

describe('AuthService (OTP, Email & SMS)', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwt: any;
  let mockOtp: any;
  let mockNotifications: any;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      workspace: {
        create: jest.fn(),
      },
      membership: {
        create: jest.fn(),
      },
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((cb) => {
        if (typeof cb === 'function') {
          return cb(mockPrisma);
        }
        return Promise.all(cb);
      }),
    };

    mockJwt = {
      signAsync: jest.fn().mockResolvedValue('mock-access-token'),
    };

    mockOtp = {
      createAndSendOtp: jest.fn().mockResolvedValue({
        success: true,
        message: 'Code sent',
        cooldownSeconds: 60,
      }),
      verifyOtp: jest.fn().mockResolvedValue({ verified: true }),
    };

    mockNotifications = {
      notifyTokenReuseAlert: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      mockPrisma as unknown as PrismaService,
      mockJwt as unknown as JwtService,
      mockOtp as unknown as OtpService,
      mockNotifications as unknown as NotificationService,
    );
  });

  describe('register', () => {
    it('creates user and dispatches verification OTP to both email and phone', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
        phone: '01712345678',
        name: 'Alice',
      });
      mockPrisma.workspace.create.mockResolvedValue({
        id: 'ws-1',
        name: 'Alice WS',
      });
      mockPrisma.membership.create.mockResolvedValue({ id: 'mem-1' });

      const res = await service.register({
        email: 'alice@example.com',
        phone: '01712345678',
        password: 'Password123!',
        name: 'Alice',
        workspaceName: 'Alice WS',
      });

      expect(res.statusCode).toBe(201);
      expect(mockOtp.createAndSendOtp).toHaveBeenCalledWith(
        'alice@example.com',
        OtpPurpose.SIGNUP_EMAIL_VERIFICATION,
        'Email Verification',
      );
      expect(mockOtp.createAndSendOtp).toHaveBeenCalledWith(
        '01712345678',
        OtpPurpose.SIGNUP_PHONE_VERIFICATION,
        'Phone Verification',
      );
    });
  });

  describe('verifyOtp', () => {
    it('verifies signup email code and updates isEmailVerified flag', async () => {
      const res = await service.verifyOtp({
        target: 'alice@example.com',
        code: '123456',
        purpose: OtpPurpose.SIGNUP_EMAIL_VERIFICATION,
      });

      expect(res.statusCode).toBe(200);
      expect(mockOtp.verifyOtp).toHaveBeenCalledWith(
        'alice@example.com',
        '123456',
        OtpPurpose.SIGNUP_EMAIL_VERIFICATION,
      );
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { email: 'alice@example.com' },
        data: { isEmailVerified: true },
      });
    });
  });

  describe('forgotPassword & resetPassword', () => {
    it('dispatches password reset OTP', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
      });

      const res = await service.forgotPassword({ target: 'alice@example.com' });
      expect(res.statusCode).toBe(200);
      expect(mockOtp.createAndSendOtp).toHaveBeenCalledWith(
        'alice@example.com',
        OtpPurpose.PASSWORD_RESET,
        'Password Reset',
      );
    });

    it('verifies code, updates password and revokes all active sessions', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-1',
        email: 'alice@example.com',
      });

      const res = await service.resetPassword({
        target: 'alice@example.com',
        code: '654321',
        newPassword: 'BrandNewPassword123!',
      });

      expect(res.statusCode).toBe(200);
      expect(mockOtp.verifyOtp).toHaveBeenCalledWith(
        'alice@example.com',
        '654321',
        OtpPurpose.PASSWORD_RESET,
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ password: expect.any(String) }),
        }),
      );
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
        }),
      );
    });
  });

  describe('requestPhoneLogin & verifyPhoneLogin', () => {
    it('sends SMS login code to registered phone', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-phone-1',
        phone: '01712345678',
      });

      const res = await service.requestPhoneLogin({ phone: '01712345678' });
      expect(res.statusCode).toBe(200);
      expect(mockOtp.createAndSendOtp).toHaveBeenCalledWith(
        '01712345678',
        OtpPurpose.PHONE_LOGIN,
        'Phone Login',
      );
    });

    it('verifies SMS OTP and logs user in with token pair', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-phone-1',
        name: 'Bob',
        email: 'bob@example.com',
        phone: '01712345678',
      });

      const res = await service.verifyPhoneLogin({
        phone: '01712345678',
        code: '123456',
      });

      expect(res.statusCode).toBe(201);
      expect(res.data.accessToken).toBe('mock-access-token');
      expect(mockOtp.verifyOtp).toHaveBeenCalledWith(
        '01712345678',
        '123456',
        OtpPurpose.PHONE_LOGIN,
      );
    });
  });

  describe('refresh token reuse alert', () => {
    it('allows concurrent refresh within 30s grace window without killing sessions', async () => {
      const presented = 'concurrent-token-value';
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'tok-recent',
        userId: 'user-active',
        revokedAt: new Date(Date.now() - 5000), // revoked 5s ago (within 30s grace period)
        user: { email: 'active@example.com' },
      });
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'tok-new' });

      const res = await service.refresh(presented);

      expect(res.statusCode).toBe(200);
      expect(res.data.accessToken).toBe('mock-access-token');
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockNotifications.notifyTokenReuseAlert).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
    });

    it('rejects invalid or empty refresh token', async () => {
      await expect(service.refresh('')).rejects.toThrow('Refresh token is required');
      // @ts-expect-error test undefined
      await expect(service.refresh(undefined)).rejects.toThrow('Refresh token is required');
    });

    it('kills sessions and dispatches instant security alert email on token reuse outside grace period', async () => {
      const presented = 'revoked-token-value';
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'tok-1',
        userId: 'user-stolen',
        revokedAt: new Date(Date.now() - 60000), // already revoked 60s ago (> 30s grace period)
        user: { email: 'victim@example.com' },
      });

      await expect(service.refresh(presented)).rejects.toThrow(
        'Refresh token reuse detected',
      );

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-stolen', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(mockNotifications.notifyTokenReuseAlert).toHaveBeenCalledWith(
        'victim@example.com',
      );
    });
  });
});
