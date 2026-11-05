import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../core/errors.js';
import type { RateLimiter, RateLimitConfig } from '../core/rate-limiter.js';

export const RATE_LIMITER = 'RATE_LIMITER';
const META = 'auth:ip-rate-limit';

// Token bucket per "<route>:<req.ip>". Only req.ip is read, never X-Forwarded-For (§3.3).
export const IpRateLimit = (capacity: number, refillPerSec: number) =>
  SetMetadata<string, RateLimitConfig>(META, { capacity, refillPerSec });

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const cfg = this.reflector.get<RateLimitConfig | undefined>(META, context.getHandler());
    if (!cfg) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const route = req.route?.path ?? req.path;
    const result = this.limiter.take(`${route}:${req.ip}`, cfg, Date.now());
    if (!result.ok) {
      throw new AppError('RATE_LIMITED', 'too many requests', { retryAfterMs: result.retryAfterMs });
    }
    return true;
  }
}
