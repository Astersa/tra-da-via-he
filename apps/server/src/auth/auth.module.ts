import { Module } from '@nestjs/common';
import { GAME_CONFIG, loadGameConfig } from '../core/game-config.js';
import { InMemoryRateLimiter } from '../core/rate-limiter.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JWT_SECRET, readJwtSecret } from './jwt.js';
import { IpRateLimitGuard, RATE_LIMITER } from './ip-rate-limit.guard.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    RefreshTokenService,
    IpRateLimitGuard,
    // Factories, not values: each app instance gets its own limiter (process-local state, §3.9).
    { provide: RATE_LIMITER, useFactory: () => new InMemoryRateLimiter() },
    { provide: JWT_SECRET, useFactory: () => readJwtSecret(process.env) },
    { provide: GAME_CONFIG, useFactory: () => loadGameConfig(process.env) },
  ],
})
export class AuthModule {}
