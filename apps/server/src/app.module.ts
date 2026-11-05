import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ApiErrorFilter } from './core/app-error.filter.js';
import { AuthCoreModule } from './core/auth-core.module.js';
import { HealthController } from './core/health.controller.js';
import { PrismaModule } from './core/prisma.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { WorldGateway } from './realtime/world.gateway.js';
import { WorldStateBuilder } from './realtime/world-state.builder.js';
import { SessionEndHooks } from './session/session-end.hooks.js';
import { SessionService } from './session/session.service.js';
import { ServersModule } from './servers/servers.module.js';
import { WorldModule } from './world/world.module.js';

@Module({
  imports: [PrismaModule, AuthCoreModule, AuthModule, ServersModule, RealtimeModule, WorldModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ApiErrorFilter },
    SessionService,
    SessionEndHooks,
    WorldStateBuilder,
    WorldGateway,
  ],
})
export class AppModule {}
