import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserService } from './user.service';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from '../communication/otp/otp.service';
import { R2Service } from './r2.service';
import { Plan, Role } from '@prisma/client';

describe('UserService', () => {
  let service: UserService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    membership: {
      updateMany: jest.Mock;
    };
    refreshToken: {
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let otpService: {
    createAndSendOtp: jest.Mock;
  };
  let r2Service: {
    createPresignedUploadUrl: jest.Mock;
    deleteObject: jest.Mock;
    verifyWebhookSecret: jest.Mock;
    parseWebhookNotification: jest.Mock;
  };

  const mockUser = {
    id: 'user-123',
    name: 'Jane Doe',
    email: 'jane@acme.com',
    phone: '01712345678',
    password: '',
    avatarUrl: 'https://assets.documind.ai/avatars/user-123/existing.jpg',
    isEmailVerified: true,
    isPhoneVerified: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    members: [
      {
        workspaceId: 'ws-1',
        role: Role.OWNER,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        workspace: {
          id: 'ws-1',
          name: 'Acme Corp',
          plan: Plan.FREE,
        },
      },
    ],
  };

  beforeAll(async () => {
    mockUser.password = await bcrypt.hash('CurrentSecret123!', 10);
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      membership: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        if (typeof callback === 'function') {
          return callback(prisma);
        }
        return Promise.all(callback);
      }),
    };

    otpService = {
      createAndSendOtp: jest.fn().mockResolvedValue({
        message: 'OTP sent successfully',
        cooldownSeconds: 60,
      }),
    };

    r2Service = {
      createPresignedUploadUrl: jest.fn().mockResolvedValue({
        uploadUrl: 'https://r2.test/upload',
        publicUrl: 'https://assets.test/avatars/user-123/new.jpg',
        key: 'avatars/user-123/new.jpg',
        expiresIn: 3600,
      }),
      deleteObject: jest.fn().mockResolvedValue(true),
      verifyWebhookSecret: jest.fn().mockReturnValue(true),
      parseWebhookNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpService, useValue: otpService },
        { provide: R2Service, useValue: r2Service },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProfile', () => {
    it('should return user profile with workspaces', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const res = await service.getProfile('user-123');

      expect(res.statusCode).toBe(200);
      expect(res.data.id).toBe('user-123');
      expect(res.data.name).toBe('Jane Doe');
      expect(res.data.avatarUrl).toBe('https://assets.documind.ai/avatars/user-123/existing.jpg');
      expect(res.data.workspaces).toHaveLength(1);
      expect(res.data.workspaces[0]).toEqual({
        workspaceId: 'ws-1',
        workspaceName: 'Acme Corp',
        role: Role.OWNER,
        plan: Plan.FREE,
        joinedAt: mockUser.members[0].createdAt,
      });
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('unknown-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('should throw BadRequestException if no fields are provided', async () => {
      await expect(service.updateProfile('user-123', {})).rejects.toThrow(BadRequestException);
    });

    it('should update name and update membership memberName atomically', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        name: 'Jane Smith',
      });

      const res = await service.updateProfile('user-123', { name: 'Jane Smith' });

      expect(res.statusCode).toBe(200);
      expect(res.data.name).toBe('Jane Smith');
      expect(prisma.membership.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        data: { memberName: 'Jane Smith' },
      });
    });

    it('should throw ConflictException if new email is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.findFirst.mockResolvedValue({ id: 'other-user', email: 'taken@acme.com' });

      await expect(
        service.updateProfile('user-123', { email: 'taken@acme.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should update email, reset verified status, and send verification OTP', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        email: 'new@acme.com',
        isEmailVerified: false,
      });

      const res = await service.updateProfile('user-123', { email: 'new@acme.com' });

      expect(res.statusCode).toBe(200);
      expect(res.data.email).toBe('new@acme.com');
      expect(res.data.isEmailVerified).toBe(false);
      expect(otpService.createAndSendOtp).toHaveBeenCalledWith(
        'new@acme.com',
        'SIGNUP_EMAIL_VERIFICATION',
        'Email Verification',
      );
    });

    it('should throw ConflictException if new phone is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.findFirst.mockResolvedValue({ id: 'other-user', phone: '01899999999' });

      await expect(
        service.updateProfile('user-123', { phone: '01899999999' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should update phone, reset verified status, and send phone verification OTP', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        phone: '01899999999',
        isPhoneVerified: false,
      });

      const res = await service.updateProfile('user-123', { phone: '01899999999' });

      expect(res.statusCode).toBe(200);
      expect(res.data.phone).toBe('01899999999');
      expect(res.data.isPhoneVerified).toBe(false);
      expect(otpService.createAndSendOtp).toHaveBeenCalledWith(
        '01899999999',
        'SIGNUP_PHONE_VERIFICATION',
        'Phone Verification',
      );
    });
  });

  describe('updatePassword', () => {
    it('should throw UnauthorizedException if current password is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.updatePassword('user-123', {
          currentPassword: 'WrongPassword!',
          newPassword: 'BrandNewPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw BadRequestException if new password is identical to current password', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.updatePassword('user-123', {
          currentPassword: 'CurrentSecret123!',
          newPassword: 'CurrentSecret123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update password and invalidate other sessions', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const res = await service.updatePassword('user-123', {
        currentPassword: 'CurrentSecret123!',
        newPassword: 'BrandNewPassword123!',
        revokeOtherSessions: true,
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      });
    });
  });

  describe('Cloudflare R2 Direct Photo Upload', () => {
    it('createAvatarUploadUrl should return presigned upload URL and public URL', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const res = await service.createAvatarUploadUrl('user-123', {
        filename: 'pic.jpg',
        contentType: 'image/jpeg',
      });

      expect(res.statusCode).toBe(200);
      expect(res.data.uploadUrl).toBe('https://r2.test/upload');
      expect(res.data.publicUrl).toBe('https://assets.test/avatars/user-123/new.jpg');
      expect(r2Service.createPresignedUploadUrl).toHaveBeenCalledWith({
        userId: 'user-123',
        filename: 'pic.jpg',
        contentType: 'image/jpeg',
      });
    });

    it('createAvatarUploadUrl should reject file size over 10MB', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.createAvatarUploadUrl('user-123', {
          fileSize: 11 * 1024 * 1024,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('confirmAvatar should persist avatarUrl to PostgreSQL', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        avatarUrl: 'https://assets.test/avatars/user-123/new.jpg',
      });

      const res = await service.confirmAvatar('user-123', {
        avatarUrl: 'https://assets.test/avatars/user-123/new.jpg',
      });

      expect(res.statusCode).toBe(200);
      expect(res.data.avatarUrl).toBe('https://assets.test/avatars/user-123/new.jpg');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { avatarUrl: 'https://assets.test/avatars/user-123/new.jpg' },
        include: expect.any(Object),
      });
    });

    it('deleteAvatar should delete avatar from DB and R2', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        avatarUrl: null,
      });

      const res = await service.deleteAvatar('user-123');

      expect(res.statusCode).toBe(200);
      expect(r2Service.deleteObject).toHaveBeenCalledWith(
        'avatars/user-123/existing.jpg',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { avatarUrl: null },
      });
    });
  });

  describe('Cloudflare R2 Webhook', () => {
    it('should reject webhook with invalid secret', async () => {
      r2Service.verifyWebhookSecret.mockReturnValue(false);

      await expect(
        service.handleR2Webhook({}, 'wrong-secret'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should parse webhook notification and update User avatarUrl', async () => {
      r2Service.verifyWebhookSecret.mockReturnValue(true);
      r2Service.parseWebhookNotification.mockReturnValue({
        userId: 'user-123',
        key: 'avatars/user-123/uploaded.png',
        publicUrl: 'https://assets.test/avatars/user-123/uploaded.png',
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue({
        ...mockUser,
        avatarUrl: 'https://assets.test/avatars/user-123/uploaded.png',
      });

      const res = await service.handleR2Webhook({ action: 'PutObject' }, 'valid-secret');

      expect(res.statusCode).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { avatarUrl: 'https://assets.test/avatars/user-123/uploaded.png' },
      });
    });
  });

  describe('Verification requests', () => {
    it('requestEmailVerification should fail if already verified', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser); // isEmailVerified is true

      await expect(service.requestEmailVerification('user-123')).rejects.toThrow(BadRequestException);
    });

    it('requestEmailVerification should send OTP if not verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        isEmailVerified: false,
      });

      const res = await service.requestEmailVerification('user-123');
      expect(res.statusCode).toBe(200);
      expect(otpService.createAndSendOtp).toHaveBeenCalledWith(
        mockUser.email,
        'SIGNUP_EMAIL_VERIFICATION',
        'Email Verification',
      );
    });

    it('requestPhoneVerification should fail if already verified', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser); // isPhoneVerified is true

      await expect(service.requestPhoneVerification('user-123')).rejects.toThrow(BadRequestException);
    });

    it('requestPhoneVerification should send OTP if not verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        isPhoneVerified: false,
      });

      const res = await service.requestPhoneVerification('user-123');
      expect(res.statusCode).toBe(200);
      expect(otpService.createAndSendOtp).toHaveBeenCalledWith(
        mockUser.phone,
        'SIGNUP_PHONE_VERIFICATION',
        'Phone Verification',
      );
    });
  });
});
