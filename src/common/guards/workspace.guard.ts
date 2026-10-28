import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AuthenticatedRequest,
  RequestScope,
} from '../interfaces/scope.interface';

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user || !user.userId) {
      throw new UnauthorizedException(
        'Authentication required to access workspace',
      );
    }

    const params = request.params as Record<string, string>;
    const workspaceId = params.workspaceId ?? params.id;
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID missing in route parameters');
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.userId,
          workspaceId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('Workspace access denied');
    }

    const scope: RequestScope = {
      workspaceId: membership.workspaceId,
      userId: user.userId,
      role: membership.role,
    };

    request.scope = scope;
    return true;
  }
}
