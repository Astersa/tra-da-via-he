import { Inject, Injectable } from '@nestjs/common';
import { WorldStateSchema, type PlayerView, type ShopSummary, type WorldState } from '@tdvh/shared';
import { PrismaService } from '../core/prisma.service.js';
import { ChatService } from '../chat/chat.service.js';
import { PresenceStore, type PresenceEntry } from '../world/presence.store.js';

// IMPLEMENTATION-PLAN.md §3.4.1 WorldState (M1-E3-T4). Read only: nothing here writes to the DB.
// Temporary values, replaced by later tasks: acceptingOrders=false and onlineStaff=0 (M3-E1-T2),
// myOpenOrders=[] (M3-E2-T6), staff=null (M4-E1-T6). recentChat comes from ChatService (M1-E4-T5).
@Injectable()
export class WorldStateBuilder {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly presence: PresenceStore,
    @Inject(ChatService) private readonly chat: ChatService,
  ) {}

  // The caller must have added the user's presence entry for this session before calling.
  async build(userId: string, serverId: string, sessionId: string): Promise<WorldState> {
    const entries = this.presence.listByServer(serverId);
    const self = entries.find((e) => e.userId === userId);
    if (!self || self.sessionId !== sessionId) throw new Error('world state requested without presence entry');

    const server = await this.prisma.gameServer.findUniqueOrThrow({
      where: { id: serverId },
      include: { worldMap: true },
    });
    const [shops, plots, wallet, profiles] = await Promise.all([
      this.prisma.shop.findMany({ where: { serverId }, include: { plot: true } }),
      this.prisma.shopPlot.findMany({
        where: { serverId },
        include: { shops: { where: { status: { not: 'CLOSED' } }, select: { id: true }, take: 1 } },
      }),
      this.prisma.wallet.findUniqueOrThrow({ where: { userId } }),
      this.prisma.playerProfile.findMany({ where: { userId: { in: entries.map((e) => e.userId) } } }),
    ]);

    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const toView = (e: PresenceEntry): PlayerView[] => {
      const profile = profileByUser.get(e.userId);
      if (!profile) return [];
      return [
        {
          userId: e.userId,
          displayName: profile.displayName,
          avatarId: profile.avatarId,
          x: e.x,
          y: e.y,
          dir: e.dir,
          seatId: e.seatId,
          connected: true,
        },
      ];
    };
    const selfView = toView(self)[0];
    if (!selfView) throw new Error('world user has no profile');

    const state = {
      sessionId,
      serverId,
      self: selfView,
      players: entries.filter((e) => e.userId !== userId).flatMap(toView),
      shops: shops.map(
        (s): ShopSummary => ({
          id: s.id,
          name: s.name,
          type: s.type,
          mapSlot: s.plot.mapSlot,
          status: s.status,
          // computeIsHiring arrives with M3-E1-T1. Until then player-owned shops read the column and
          // DEFAULT shops report false.
          isHiring: s.type === 'PLAYER_OWNED' ? s.isHiring : false,
          acceptingOrders: false,
          onlineStaff: 0,
        }),
      ),
      plots: plots.map((p) => ({
        id: p.id,
        mapSlot: p.mapSlot,
        kind: p.kind,
        openFee: p.openFee.toString(),
        shopId: p.shops.at(0)?.id ?? null,
      })),
      // Seats held by players on this server, from presence (M1-E4-T4). Grace-period players keep theirs.
      takenSeats: entries.flatMap((e) => (e.seatId === null ? [] : [{ seatId: e.seatId, userId: e.userId }])),
      recentChat: this.chat.getRecent(serverId),
      wallet: {
        balance: wallet.balance.toString(),
        held: wallet.heldBalance.toString(),
        available: (wallet.balance - wallet.heldBalance).toString(),
        version: wallet.version,
      },
      myOpenOrders: [],
      staff: null,
      mapVersion: server.worldMap.version,
    };
    return WorldStateSchema.parse(state);
  }
}
