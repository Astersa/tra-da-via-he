import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ListServersResSchema, QuickJoinResSchema } from '@tdvh/shared';
import { JwtGuard } from '../core/jwt.guard.js';
import { ServersService } from './servers.service.js';

@Controller('servers')
@UseGuards(JwtGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  async list() {
    return ListServersResSchema.parse({ items: await this.servers.list() });
  }

  @Post('quick-join')
  @HttpCode(200)
  async quickJoin() {
    return QuickJoinResSchema.parse(await this.servers.quickJoin());
  }
}
