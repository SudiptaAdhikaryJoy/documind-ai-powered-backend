import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';

export interface JwtUserPayload {
  userId: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET', 'replace-me');
    super({
      jwtFromRequest: (req: Request) => {
        // Standard Authorization header (handles "Bearer <token>" and trims extra prefixes)
        const auth = req?.headers?.authorization;
        if (typeof auth === 'string') {
          const cleaned = auth.replace(/^(Bearer\s+)+/i, '').trim();
          if (cleaned) {
            return cleaned;
          }
        }

        // Cookie fallback (for web clients using accessToken cookie)
        const cookieHeader = req?.headers?.cookie;
        if (typeof cookieHeader === 'string') {
          const match = /(?:^|;\s*)accessToken=([^;]*)/.exec(cookieHeader);
          if (match && match[1]) {
            return decodeURIComponent(match[1]);
          }
        }

        return null;
      },
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: { sub: string; email: string }): JwtUserPayload {
    if (!payload || !payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return { userId: payload.sub, email: payload.email };
  }
}
