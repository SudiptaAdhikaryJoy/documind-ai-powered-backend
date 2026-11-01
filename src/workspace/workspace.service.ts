import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpPurpose, Role } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { RequestScope } from '../common/interfaces/scope.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  AcceptInviteDto,
  CreateWorkspaceDto,
  DeleteWorkspaceDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
} from './dto/workspace.dto';
import { MailService } from '../communication/mail/mail.service';
import { EmailTemplates } from '../communication/mail/templates/email-templates';
import { OtpService } from '../communication/otp/otp.service';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class WorkspaceService {
  private readonly webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3001';

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly otp: OtpService,
  ) {}

  async listUserWorkspaces(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: {
        workspace: true,
      },
      orderBy: { workspace: { createdAt: 'desc' } },
    });

    const data = memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      plan: m.workspace.plan,
      role: m.role,
      createdAt: m.workspace.createdAt,
    }));

    return {
      statusCode: 200,
      message: 'Workspaces fetched successfully',
      data: data,
    };
  }

  async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      if (!user) throw new NotFoundException('User not found');

      const workspace = await tx.workspace.create({
        data: { name: dto.name },
      });

      const membership = await tx.membership.create({
        data: {
          userId,
          workspaceId: workspace.id,
          memberName: user.name,
          workspaceName: workspace.name,
          role: Role.OWNER,
        },
      });

      return {
        statusCode: 201,
        message: 'Workspace created successfully',
        data: {
          id: workspace.id,
          name: workspace.name,
          plan: workspace.plan,
          role: membership.role,
          createdAt: workspace.createdAt,
        },
      };
    });
  }

  async getWorkspace(scope: RequestScope) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: scope.workspaceId },
      include: {
        _count: {
          select: {
            members: true,
            documents: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return {
      statusCode: 200,
      message: 'Single workspace fetched successfully',
      data: {
        id: workspace.id,
        name: workspace.name,
        plan: workspace.plan,
        role: scope.role,
        memberCount: workspace._count.members,
        documentCount: workspace._count.documents,
        createdAt: workspace.createdAt,
      },
    };
  }

  async getMembers(scope: RequestScope) {
    const members = await this.prisma.membership.findMany({
      where: { workspaceId: scope.workspaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: { role: 'asc' },
    });

    const data = members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      phone: m.user.phone,
      role: m.role,
    }));

    return {
      statusCode: 200,
      message: 'Members fetched successfully',
      data: data,
    };
  }

  async inviteMember(scope: RequestScope, dto: InviteMemberDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException(
        'Either email or phone is required to invite a member',
      );
    }

    const [inviter, workspace] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: scope.userId },
        select: { name: true, email: true },
      }),
      this.prisma.workspace.findUnique({
        where: { id: scope.workspaceId },
        select: { id: true, name: true },
      }),
    ]);

    if (!workspace) throw new NotFoundException('Workspace not found');
    const inviterName = inviter?.name ?? 'A team member';

    // 1. Check if the target user is already registered in the system
    const targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          dto.email ? { email: dto.email.trim().toLowerCase() } : undefined,
          dto.phone ? { phone: dto.phone.trim() } : undefined,
        ].filter(Boolean) as Array<{ email?: string; phone?: string }>,
      },
    });

    if (targetUser) {
      const existing = await this.prisma.membership.findUnique({
        where: {
          userId_workspaceId: {
            userId: targetUser.id,
            workspaceId: scope.workspaceId,
          },
        },
      });

      if (existing) {
        throw new ConflictException('User is already a member of this workspace');
      }

      const membership = await this.prisma.membership.create({
        data: {
          userId: targetUser.id,
          workspaceId: scope.workspaceId,
          memberName: targetUser.name,
          workspaceName: workspace.name,
          role: dto.role ?? Role.MEMBER,
        },
      });

      // Notify existing user via email
      if (targetUser.email) {
        const inviteUrl = `${this.webOrigin}/workspaces/${workspace.id}`;
        const { subject, html, text } = EmailTemplates.workspaceInviteTemplate(
          inviterName,
          workspace.name,
          membership.role,
          inviteUrl,
        );
        void this.mail.send({ to: targetUser.email, subject, html, text }).catch(() => undefined);
      }

      return {
        statusCode: 201,
        message: 'Member invited and added successfully',
        data: {
          id: membership.id,
          userId: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          phone: targetUser.phone,
          role: membership.role,
        },
      };
    }

    // 2. User is not registered yet: create a WorkspaceInvite record & send email invite
    if (!dto.email) {
      throw new NotFoundException(
        'User with the provided phone was not found. Please provide an email address to send an invitation.',
      );
    }

    const rawToken = randomBytes(24).toString('hex');
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 86_400_000); // 7 days

    await this.prisma.workspaceInvite.create({
      data: {
        workspaceId: scope.workspaceId,
        email: dto.email.trim().toLowerCase(),
        role: dto.role ?? Role.MEMBER,
        tokenHash,
        expiresAt,
      },
    });

    const inviteUrl = `${this.webOrigin}/workspaces/join?token=${rawToken}`;
    const { subject, html, text } = EmailTemplates.workspaceInviteTemplate(
      inviterName,
      workspace.name,
      dto.role ?? Role.MEMBER,
      inviteUrl,
    );
    await this.mail.send({ to: dto.email.trim().toLowerCase(), subject, html, text });

    return {
      statusCode: 201,
      message: `Invitation email dispatched to ${dto.email}`,
      data: {
        email: dto.email,
        role: dto.role ?? Role.MEMBER,
        expiresAt,
      },
    };
  }

  async acceptInvite(userId: string, dto: AcceptInviteDto) {
    const tokenHash = sha256(dto.token.trim());
    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { tokenHash },
      include: { workspace: true },
    });

    if (!invite || invite.acceptedAt) {
      throw new NotFoundException('Invitation token is invalid or has already been accepted');
    }

    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired. Please request a new invite.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    const existingMembership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId: invite.workspaceId,
        },
      },
    });

    if (existingMembership) {
      await this.prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      return {
        statusCode: 200,
        message: 'You are already a member of this workspace',
        data: {
          workspaceId: invite.workspaceId,
          role: existingMembership.role,
        },
      };
    }

    const [membership] = await this.prisma.$transaction([
      this.prisma.membership.create({
        data: {
          userId,
          workspaceId: invite.workspaceId,
          memberName: user.name,
          workspaceName: invite.workspace.name,
          role: invite.role,
        },
      }),
      this.prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return {
      statusCode: 200,
      message: `Joined workspace "${invite.workspace.name}" successfully`,
      data: {
        workspaceId: invite.workspaceId,
        workspaceName: invite.workspace.name,
        role: membership.role,
      },
    };
  }

  async requestStepUp(scope: RequestScope) {
    const owner = await this.prisma.user.findUnique({
      where: { id: scope.userId },
    });
    if (!owner) throw new NotFoundException('Owner account not found');

    const target = owner.email || owner.phone;
    const result = await this.otp.createAndSendOtp(
      target,
      OtpPurpose.STEP_UP_ACTION,
      'Sensitive Action Confirmation',
    );

    return {
      statusCode: 200,
      message: 'Confirmation code sent to workspace owner',
      data: { cooldownSeconds: result.cooldownSeconds },
    };
  }

  async deleteWorkspace(scope: RequestScope, dto?: DeleteWorkspaceDto) {
    const owner = await this.prisma.user.findUnique({
      where: { id: scope.userId },
    });
    if (!owner) throw new NotFoundException('Owner account not found');

    // If step-up OTP is provided or enforced, verify it
    if (dto?.stepUpOtp) {
      const target = owner.email || owner.phone;
      await this.otp.verifyOtp(target, dto.stepUpOtp, OtpPurpose.STEP_UP_ACTION);
    }

    await this.prisma.workspace.delete({
      where: { id: scope.workspaceId },
    });

    return {
      statusCode: 200,
      message: 'Workspace deleted successfully',
    };
  }

  async updateMemberRole(
    scope: RequestScope,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: targetUserId,
          workspaceId: scope.workspaceId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Member not found in this workspace');
    }

    if (membership.role === Role.OWNER && dto.role !== Role.OWNER) {
      const ownerCount = await this.prisma.membership.count({
        where: {
          workspaceId: scope.workspaceId,
          role: Role.OWNER,
        },
      });

      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot demote the sole workspace owner');
      }
    }

    const updated = await this.prisma.membership.update({
      where: { id: membership.id },
      data: { role: dto.role },
      include: { user: true },
    });

    return {
      statusCode: 200,
      message: 'Member role updated successfully',
      data: {
        id: updated.id,
        userId: updated.user.id,
        name: updated.user.name,
        email: updated.user.email,
        phone: updated.user.phone,
        role: updated.role,
      },
    };
  }
}
