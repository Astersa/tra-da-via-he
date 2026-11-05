import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthResSchema, GuestReqSchema, LoginReqSchema, RefreshResSchema } from '@tdvh/shared';
import type { Request, Response } from 'express';
import { AppError } from '../core/errors.js';
import { parseOrThrow } from '../core/validation.js';
import { AuthService } from './auth.service.js';
import { IpRateLimit, IpRateLimitGuard } from './ip-rate-limit.guard.js';
import { REFRESH_COOKIE, refreshCookieOptions } from './refresh-token.service.js';

// POST /auth/upgrade belongs to a later card. There is no /auth/register (B5).
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit(5, 5 / 60)
  async guest(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const input = parseOrThrow(GuestReqSchema, body);
    const { auth, refresh } = await this.auth.createGuest(req.ip ?? '', input);
    res.cookie(REFRESH_COOKIE, refresh.raw, refreshCookieOptions());
    return AuthResSchema.parse(auth);
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit(10, 10 / 60)
  async login(@Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const input = parseOrThrow(LoginReqSchema, body);
    const { auth, refresh } = await this.auth.login(input);
    res.cookie(REFRESH_COOKIE, refresh.raw, refreshCookieOptions());
    return AuthResSchema.parse(auth);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = readRefreshCookie(req);
    if (!raw) throw new AppError('UNAUTHENTICATED');
    const { auth, refresh } = await this.auth.refresh(raw);
    res.cookie(REFRESH_COOKIE, refresh.raw, refreshCookieOptions());
    return RefreshResSchema.parse(auth);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  }
}

// Missing or empty cookie is UNAUTHENTICATED (§3.3).
function readRefreshCookie(req: Request): string | undefined {
  const raw: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}
