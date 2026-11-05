import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_RATE_LIMITS, type Ack, type ClientEvent } from '@tdvh/shared';
import type { Socket } from 'socket.io';
import type { ZodType } from 'zod';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import type { RateLimiter } from '../core/rate-limiter.js';
import { InMemoryRateLimiter } from '../core/rate-limiter.js';
import { parseOrThrow } from '../core/validation.js';
import { ConnectionRegistry } from './connection-registry.js';
import type { EventCtx, SocketData } from './event-router.js';

export const EVENT_RATE_LIMITER = 'EVENT_RATE_LIMITER';

export type AckFn = (res: Ack<unknown>) => void;

export function createEventRateLimiter(): RateLimiter {
  return new InMemoryRateLimiter();
}

// Single path for every client event (§3.4): session, rate limit, zod, handler, ack.
@Injectable()
export class EventPipeline {
  private readonly logger = new Logger('EventPipeline');

  constructor(
    @Inject(EVENT_RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly registry: ConnectionRegistry,
  ) {}

  async handleEvent<Req, Res>(
    socket: Socket,
    event: ClientEvent,
    raw: unknown,
    ack: AckFn | undefined,
    opts: { schema: ZodType<Req>; requireSession: boolean },
    fn: (ctx: EventCtx, req: Req) => Promise<Res>,
  ): Promise<void> {
    const requestId = randomUUID();
    const reply = (res: Ack<unknown>): void => {
      if (typeof ack === 'function') ack(res);
    };
    try {
      const data = socket.data as SocketData;
      if (!data.userId) throw new AppError('UNAUTHENTICATED');

      if (opts.requireSession) {
        const current = data.sessionId !== undefined && this.registry.isCurrent(data.userId, data.sessionId);
        if (!current) throw new AppError('SESSION_STALE');
      }

      const limit = this.limiter.take(`${data.userId}:${event}`, EVENT_RATE_LIMITS[event], this.clock.now().getTime());
      if (!limit.ok) throw new AppError('RATE_LIMITED', 'rate limited', { retryAfterMs: limit.retryAfterMs });

      const req = parseOrThrow(opts.schema, raw);
      const res = await fn({ userId: data.userId, socket, requestId }, req);
      reply({ ok: true, data: res });
    } catch (err) {
      if (err instanceof AppError) {
        const retryAfterMs = err.details?.retryAfterMs;
        reply({
          ok: false,
          error: {
            code: err.code,
            message: err.message,
            retryable: err.retryable,
            ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {}),
          },
        });
        return;
      }
      // Details go to the server log only, never to the client.
      this.logger.error(`event ${event} failed requestId=${requestId}`, err instanceof Error ? err.stack : String(err));
      reply({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'internal error', retryable: true } });
    }
  }
}
