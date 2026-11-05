import { Injectable, SetMetadata, type CanActivate } from '@nestjs/common';

// RED-PHASE STUB (M1-E1-T3): exports only, behaviour not implemented yet.
export const ROLES_KEY = 'auth:roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class JwtGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
