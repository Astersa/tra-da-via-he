import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service.js';
import type { PrismaClient } from '../generated/prisma/client.js';

// IMPLEMENTATION-PLAN.md §3.3, M1-E2-T2. Counts players online on one server.
// Presence (M1-E4-T3) is not built yet, so the default counts ACTIVE ServerSession rows in the DB.
// Async because the DB is read; M1-E4-T3 may replace it with an in-memory PresenceStore.
export interface OnlineCounter {
  count(serverId: string): Promise<number>;
}

export const ONLINE_COUNTER = 'ONLINE_COUNTER';

@Injectable()
export class DbOnlineCounter implements OnlineCounter {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {}

  count(serverId: string): Promise<number> {
    return this.prisma.serverSession.count({ where: { serverId, status: 'ACTIVE' } });
  }
}
