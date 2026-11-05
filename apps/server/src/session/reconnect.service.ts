import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BootTasks } from '../core/boot-tasks.js';
import { GAME_CONFIG, type GameConfig } from '../core/game-config.js';
import { SessionService } from './session.service.js';

// IMPLEMENTATION-PLAN.md §3.5.2, §3.10.4, §3.10.5 (M1-E3-T5). Owns the grace timers: at most one per user.
// A timer only schedules. What happens at expiry is decided by the caller, which runs it under the user lock
// and checks again that the session is still waiting for a reconnect.
export interface PendingGrace {
  sessionId: string;
  serverId: string;
}

@Injectable()
export class ReconnectService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ReconnectService');
  private readonly timers = new Map<string, PendingGrace & { timer: ReturnType<typeof setTimeout> }>();
  // Set by onModuleDestroy. Sockets close after it (io.close), and their disconnect must not start a timer.
  private closed = false;

  constructor(
    @Inject(GAME_CONFIG) private readonly config: GameConfig,
    @Inject(BootTasks) private readonly boot: BootTasks,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  onModuleInit(): void {
    // Order 10: ACTIVE sessions left from before a restart are ended before listen. No hooks run (§3.5.2).
    this.boot.register(10, 'end-sessions', async () => {
      await this.sessions.endAllOnBoot();
    });
  }

  // Starts the grace period for this user, replacing any timer already running.
  schedule(userId: string, sessionId: string, serverId: string, onExpire: () => Promise<void>): void {
    if (this.closed) return;
    this.cancel(userId);
    const timer = setTimeout(() => {
      onExpire().catch((err: unknown) => {
        this.logger.error(`grace expiry failed sessionId=${sessionId}`, err instanceof Error ? err.stack : String(err));
      });
    }, this.config.reconnectGraceSeconds * 1000);
    this.timers.set(userId, { sessionId, serverId, timer });
  }

  pendingFor(userId: string): PendingGrace | undefined {
    const p = this.timers.get(userId);
    return p ? { sessionId: p.sessionId, serverId: p.serverId } : undefined;
  }

  cancel(userId: string): void {
    const p = this.timers.get(userId);
    if (!p) return;
    clearTimeout(p.timer);
    this.timers.delete(userId);
  }

  pendingCount(): number {
    return this.timers.size;
  }

  // Clears every timer without ending any session (§3.10.4: the DB is left as it is).
  onModuleDestroy(): void {
    this.closed = true;
    for (const p of this.timers.values()) clearTimeout(p.timer);
    this.timers.clear();
  }
}
