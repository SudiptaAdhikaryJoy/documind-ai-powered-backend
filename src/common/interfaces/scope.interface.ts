import { Request } from 'express';
import { Role } from '@prisma/client';
import { JwtUserPayload } from '../../auth/jwt.strategy';

export interface RequestScope {
  workspaceId: string;
  userId: string;
  role: Role;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtUserPayload;
  scope?: RequestScope;
}
