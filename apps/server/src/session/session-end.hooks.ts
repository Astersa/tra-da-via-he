import { Injectable, Logger } from '@nestjs/common';
import type { SessionEndReason } from '../generated/prisma/client.js';

// IMPLEMENTATION-PLAN.md §3.5.2 "Việc phải làm khi session kết thúc" (M1-E3-T4).
export interface SessionEndedEvent {
  userId: string;
  sessionId: string;
  serverId: string;
  reason: SessionEndReason;
}

export type SessionEndHook = (e: SessionEndedEvent) => Promise<void>;

// Hooks run after the session transaction has committed, one after another. A failing hook is logged
// and the rest still run; the sweeper is the safety net for orders (§3.5.2). Later modules register here.
@Injectable()
export class SessionEndHooks {
  private readonly logger = new Logger('SessionEndHooks');
  private readonly hooks: SessionEndHook[] = [];

  register(fn: SessionEndHook): void {
    this.hooks.push(fn);
  }

  async run(e: SessionEndedEvent): Promise<void> {
    for (const fn of this.hooks) {
      try {
        await fn(e);
      } catch (err) {
        this.logger.error(
          `session end hook failed sessionId=${e.sessionId} reason=${e.reason}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
