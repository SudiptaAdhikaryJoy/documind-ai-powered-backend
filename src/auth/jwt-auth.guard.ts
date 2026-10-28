import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    err: unknown,
    user: unknown,
    info: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      let detail = '';
      if (info instanceof Error) {
        detail = info.message;
      } else if (
        typeof info === 'object' &&
        info !== null &&
        'message' in info &&
        typeof (info as Record<string, unknown>).message === 'string'
      ) {
        detail = (info as Record<string, unknown>).message as string;
      }

      const msg = detail
        ? `Authentication failed: ${detail}`
        : 'Missing or invalid authorization token. Include "Authorization: Bearer <token>" in the request headers.';
      throw (err as Error) || new UnauthorizedException(msg);
    }
    return user as TUser;
  }
}
