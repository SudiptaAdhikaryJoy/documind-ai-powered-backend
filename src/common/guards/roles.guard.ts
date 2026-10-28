import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../interfaces/scope.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const scope = request.scope;

    if (!scope || !scope.role) {
      throw new ForbiddenException(
        'Access denied: workspace scope or role not established',
      );
    }

    const hasRole = requiredRoles.includes(scope.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Insufficient permissions: requires one of [${requiredRoles.join(', ')}]`,
      );
    }

    return true;
  }
}
