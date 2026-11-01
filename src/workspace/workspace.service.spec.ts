import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OtpPurpose, Role } from '@prisma/client';
import { createHash } from 'crypto';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../communication/mail/mail.service';
import { OtpService } from '../communication/otp/otp.service';
import { RequestScope } from '../common/interfaces/scope.interface';

const sha256 = (val: string) => createHash('sha256').update(val).digest('hex');

describe('WorkspaceService (Invitations & 2FA Step-Up)', () => {
  let service: WorkspaceService;
  let mockPrisma: any;
  let mockMail: any;
  let mockOtp: any;

  const mockScope: RequestScope = {
    userId: 'owner-id',
    workspaceId: 'ws-123',
    role: Role.OWNER,
  };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      workspace: {
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      membership: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      workspaceInvite: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb) => {
        if (typeof cb === 'function') {
          return cb(mockPrisma);
        }
        return Promise.all(cb);
      }),
    };

    mockMail = {
      send: jest.fn().mockResolvedValue({ messageId: 'msg-1' }),
    };

    mockOtp = {
      createAndSendOtp: jest.fn().mockResolvedValue({
        success: true,
        message: 'Step-up code sent',
        cooldownSeconds: 60,
      }),
      verifyOtp: jest.fn().mockResolvedValue({ verified: true }),
    };

    service = new WorkspaceService(
      mockPrisma as unknown as PrismaService,
      mockMail as unknown as MailService,
      mockOtp as unknown as OtpService,
    );
  });

  describe('inviteMember', () => {
    it('dispatches invitation email and creates WorkspaceInvite token if recipient is not registered', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Owner Alice' });
      mockPrisma.workspace.findUnique.mockResolvedValue({ id: 'ws-123', name: 'Core Eng' });
      mockPrisma.user.findFirst.mockResolvedValue(null); // not yet registered
      mockPrisma.workspaceInvite.create.mockResolvedValue({ id: 'inv-1' });

      const res = await service.inviteMember(mockScope, {
        email: 'newuser@example.com',
        role: Role.MEMBER,
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.workspaceInvite.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-123',
          email: 'newuser@example.com',
          role: Role.MEMBER,
          tokenHash: expect.any(String),
        }),
      });
      expect(mockMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'newuser@example.com',
          subject: expect.stringContaining('Core Eng'),
        }),
      );
    });

    it('adds existing user immediately and notifies them via email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Owner Alice' });
      mockPrisma.workspace.findUnique.mockResolvedValue({ id: 'ws-123', name: 'Core Eng' });
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-existing',
        name: 'Bob',
        email: 'bob@example.com',
      });
      mockPrisma.membership.findUnique.mockResolvedValue(null); // not yet member
      mockPrisma.membership.create.mockResolvedValue({
        id: 'mem-new',
        role: Role.MEMBER,
      });

      const res = await service.inviteMember(mockScope, {
        email: 'bob@example.com',
        role: Role.MEMBER,
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.membership.create).toHaveBeenCalled();
    });
  });

  describe('acceptInvite', () => {
    it('validates invite token and joins workspace', async () => {
      const rawToken = 'sample_invite_token';
      mockPrisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-123',
        role: Role.MEMBER,
        expiresAt: new Date(Date.now() + 86400000),
        acceptedAt: null,
        workspace: { name: 'Core Eng' },
      });
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Charlie' });
      mockPrisma.membership.findUnique.mockResolvedValue(null);
      mockPrisma.membership.create.mockResolvedValue({ id: 'mem-charlie', role: Role.MEMBER });
      mockPrisma.workspaceInvite.update.mockResolvedValue({ id: 'inv-1' });

      const res = await service.acceptInvite('user-charlie', { token: rawToken });
      expect(res.statusCode).toBe(200);
      expect(mockPrisma.workspaceInvite.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256(rawToken) },
        include: { workspace: true },
      });
    });

    it('rejects expired invitation token', async () => {
      mockPrisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'inv-1',
        workspaceId: 'ws-123',
        role: Role.MEMBER,
        expiresAt: new Date(Date.now() - 1000), // expired
        acceptedAt: null,
        workspace: { name: 'Core Eng' },
      });

      await expect(
        service.acceptInvite('user-charlie', { token: 'expired_token' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('step-up 2FA and deleteWorkspace', () => {
    it('requests step-up OTP sent to owner', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'owner-id',
        email: 'owner@example.com',
      });

      const res = await service.requestStepUp(mockScope);
      expect(res.statusCode).toBe(200);
      expect(mockOtp.createAndSendOtp).toHaveBeenCalledWith(
        'owner@example.com',
        OtpPurpose.STEP_UP_ACTION,
        'Sensitive Action Confirmation',
      );
    });

    it('verifies step-up OTP when deleting workspace', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'owner-id',
        email: 'owner@example.com',
      });
      mockPrisma.workspace.delete.mockResolvedValue({ id: 'ws-123' });

      const res = await service.deleteWorkspace(mockScope, { stepUpOtp: '998877' });
      expect(res.statusCode).toBe(200);
      expect(mockOtp.verifyOtp).toHaveBeenCalledWith(
        'owner@example.com',
        '998877',
        OtpPurpose.STEP_UP_ACTION,
      );
      expect(mockPrisma.workspace.delete).toHaveBeenCalledWith({
        where: { id: 'ws-123' },
      });
    });
  });
});
