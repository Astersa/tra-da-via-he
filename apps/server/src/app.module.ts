import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ApiErrorFilter } from './core/app-error.filter.js';
import { AuthCoreModule } from './core/auth-core.module.js';
import { HealthController } from './core/health.controller.js';
import { PrismaModule } from './core/prisma.module.js';
import { ServersModule } from './servers/servers.module.js';

@Module({
  imports: [PrismaModule, AuthCoreModule, AuthModule, ServersModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
