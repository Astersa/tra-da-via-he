import { Global, Module } from '@nestjs/common';
import { JWT_SECRET, readJwtSecret } from './jwt.js';
import { JwtGuard, RolesGuard } from './jwt.guard.js';

// Global so every server module can guard routes without importing auth (§3.1: core is the leaf kernel).
@Global()
@Module({
  providers: [
    { provide: JWT_SECRET, useFactory: () => readJwtSecret(process.env) },
    JwtGuard,
    RolesGuard,
  ],
  exports: [JWT_SECRET, JwtGuard, RolesGuard],
})
export class AuthCoreModule {}
