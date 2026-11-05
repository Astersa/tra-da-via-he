import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UuidSchema, type UserKind, type UserRole } from '@tdvh/shared';
import type { Request } from 'express';
import { AppError } from './errors.js';
import { PrismaService } from './prisma.service.js';
import { JWT_SECRET, verifyAccessToken } from './jwt.js';

export interface AuthUser {
  id: string;
  role: UserRole;
  kind: UserKind;
}

export type AuthedRequest = Request & { user?: AuthUser };

export const ROLES_KEY = 'auth:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

// Only `sub` is read from the token. role, kind and ban state come from the DB on every request.
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    @Inject(JWT_SECRET) private readonly secret: string,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
    if (!match) throw new AppError('UNAUTHENTICATED');

    const { sub } = await verifyAccessToken(this.secret, match[1]);
    if (!UuidSchema.safeParse(sub).success) throw new AppError('UNAUTHENTICATED');

    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, role: true, kind: true, bannedAt: true },
    });
    if (!user || user.bannedAt !== null) throw new AppError('UNAUTHENTICATED');

    req.user = { id: user.id, role: user.role, kind: user.kind };
    return true;
  }
}

// Must run after JwtGuard (@UseGuards(JwtGuard, RolesGuard)).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw new AppError('UNAUTHENTICATED');
    if (!roles.includes(req.user.role)) throw new AppError('FORBIDDEN');
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser | undefined => {
  return context.switchToHttp().getRequest<AuthedRequest>().user;
});
