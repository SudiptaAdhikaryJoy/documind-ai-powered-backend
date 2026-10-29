import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { RequestScope } from '../common/interfaces/scope.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateWorkspaceDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
} from './dto/workspace.dto';

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

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

    const targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          dto.email ? { email: dto.email } : undefined,
          dto.phone ? { phone: dto.phone } : undefined,
        ].filter(Boolean) as Array<{ email?: string; phone?: string }>,
      },
    });

    if (!targetUser) {
      throw new NotFoundException(
        'User with the provided email or phone was not found',
      );
    }

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

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: scope.workspaceId },
      select: { name: true },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
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

    return {
      statusCode: 201,
      message: 'Member invited successfully',
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
