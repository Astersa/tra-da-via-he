import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PlayerMovedEvt } from '@tdvh/shared';
import { REALTIME_PUBLISHER, type RealtimePublisher } from '../core/realtime-publisher.js';
import { PresenceStore } from './presence.store.js';

// IMPLEMENTATION-PLAN.md §3.4.3 (player:moved, tick 100 ms), M1-E4-T3.
export const WORLD_TICK_MS = 100;

@Injectable()
export class WorldTickService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(PresenceStore) private readonly store: PresenceStore,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), WORLD_TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // Sends one batched, volatile player:moved per server for entries changed since the last tick.
  tick(): void {
    const dirty = this.store.drainDirty();
    if (dirty.length === 0) return;
    const byServer = new Map<string, PlayerMovedEvt['moves']>();
    for (const e of dirty) {
      const moves = byServer.get(e.serverId) ?? [];
      moves.push({ userId: e.userId, x: e.x, y: e.y, dir: e.dir, seq: e.seq });
      byServer.set(e.serverId, moves);
    }
    for (const [serverId, moves] of byServer) {
      this.realtime.toServerVolatile(serverId, 'player:moved', { moves });
    }
  }
}
