import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { MeResSchema, PatchProfileReqSchema, PatchProfileResSchema } from '@tdvh/shared';
import { CurrentUser, JwtGuard, type AuthUser } from '../core/jwt.guard.js';
import { parseOrThrow } from '../core/validation.js';
import { UsersService } from './users.service.js';

@Controller('me')
@UseGuards(JwtGuard)
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async me(@CurrentUser() user: AuthUser) {
    return MeResSchema.parse(await this.users.getMe(user.id));
  }

  @Patch('profile')
  async patchProfile(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parseOrThrow(PatchProfileReqSchema, body);
    return PatchProfileResSchema.parse({ profile: await this.users.updateProfile(user.id, input) });
  }
}
