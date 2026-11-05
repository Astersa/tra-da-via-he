import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthResSchema, GuestReqSchema, LoginReqSchema } from '@tdvh/shared';
import type { Request } from 'express';
import { parseOrThrow } from '../core/validation.js';
import { AuthService } from './auth.service.js';
import { IpRateLimit, IpRateLimitGuard } from './ip-rate-limit.guard.js';

// POST /auth/upgrade and /auth/refresh belong to later cards. There is no /auth/register (B5).
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit(5, 5 / 60)
  async guest(@Req() req: Request, @Body() body: unknown) {
    const input = parseOrThrow(GuestReqSchema, body);
    return AuthResSchema.parse(await this.auth.createGuest(req.ip ?? '', input));
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(IpRateLimitGuard)
  @IpRateLimit(10, 10 / 60)
  async login(@Body() body: unknown) {
    const input = parseOrThrow(LoginReqSchema, body);
    return AuthResSchema.parse(await this.auth.login(input));
  }
}
