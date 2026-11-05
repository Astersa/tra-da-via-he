import { Module } from '@nestjs/common';
import { PrismaModule } from '../core/prisma.module.js';
import { ServersController } from './servers.controller.js';
import { DbOnlineCounter, ONLINE_COUNTER } from './online-counter.js';
import { ServersService } from './servers.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ServersController],
  providers: [
    ServersService,
    DbOnlineCounter,
    { provide: ONLINE_COUNTER, useExisting: DbOnlineCounter },
  ],
  exports: [ONLINE_COUNTER],
})
export class ServersModule {}
