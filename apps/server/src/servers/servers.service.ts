import { Inject, Injectable } from '@nestjs/common';
import { ServerCardSchema } from '@tdvh/shared';
import type { z } from 'zod';
import { AppError } from '../core/errors.js';
import { PrismaService } from '../core/prisma.service.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ONLINE_COUNTER, type OnlineCounter } from './online-counter.js';

type ServerCard = z.infer<typeof ServerCardSchema>;

// load: online/softCap. Under 40% LOW, under 75% MEDIUM, otherwise HIGH (§3.3).
// Integer math avoids float rounding at the thresholds.
export function loadLevel(online: number, softCap: number): ServerCard['load'] {
  if (online * 100 < softCap * 40) return 'LOW';
  if (online * 100 < softCap * 75) return 'MEDIUM';
  return 'HIGH';
}

@Injectable()
export class ServersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaClient,
    @Inject(ONLINE_COUNTER) private readonly onlineCounter: OnlineCounter,
  ) {}

  // Only ACTIVE servers. activeShops = shops not CLOSED. freePlots = PURCHASABLE plots with no shop that is not CLOSED.
  async list(): Promise<ServerCard[]> {
    const servers = await this.prisma.gameServer.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const cards: ServerCard[] = [];
    for (const s of servers) {
      const online = await this.onlineCounter.count(s.id);
      const activeShops = await this.prisma.shop.count({
        where: { serverId: s.id, status: { not: 'CLOSED' } },
      });
      const freePlots = await this.prisma.shopPlot.count({
        where: {
          serverId: s.id,
          kind: 'PURCHASABLE',
          shops: { none: { status: { not: 'CLOSED' } } },
        },
      });
      cards.push({
        id: s.id,
        slug: s.slug,
        name: s.name,
        online,
        activeShops,
        freePlots,
        load: loadLevel(online, s.softCap),
      });
    }
    return cards;
  }

  // Picks the ACTIVE server with the most online players that is still below softCap. Ties: smallest id.
  // Does not create a session. No candidate: SERVER_FULL (§3.3 card, all full).
  async quickJoin(): Promise<{ serverId: string }> {
    const servers = await this.prisma.gameServer.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      select: { id: true, softCap: true },
    });
    let best: { id: string; online: number } | undefined;
    for (const s of servers) {
      const online = await this.onlineCounter.count(s.id);
      if (online >= s.softCap) continue;
      if (!best || online > best.online) best = { id: s.id, online };
    }
    if (!best) throw new AppError('SERVER_FULL');
    return { serverId: best.id };
  }
}
