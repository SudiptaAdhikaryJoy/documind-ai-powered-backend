import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AuthenticatedRequest,
  RequestScope,
} from '../interfaces/scope.interface';

export const Scope = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RequestScope => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const scope = request.scope;

    if (!scope || !scope.workspaceId || !scope.userId) {
      throw new InternalServerErrorException(
        'RequestScope not found on request. Ensure WorkspaceGuard is applied to the endpoint.',
      );
    }

    return scope;
  },
);
