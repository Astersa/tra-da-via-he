import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { PrismaService } from '../core/prisma.service.js';
import { withTx, type Tx } from '../core/tx.js';
import type { GameServer, PrismaClient, ServerSession, SessionEndReason } from '../generated/prisma/client.js';
import type { ServerContext } from './server-context.js';

// IMPLEMENTATION-PLAN.md §3.5.2, §3.5.3, §3.6.1 (M1-E3-T3).
// Every method runs in withTx. The per-user lock is pg_advisory_xact_lock on
// hashtextextended('session:' || userId, 0), not a User row lock and not FOR UPDATE.
export interface EndedSession {
  id: string;
  serverId: string;
}

export interface JoinResult {
  session: ServerSession;
  ended?: EndedSession;
  reused: boolean;
}

export interface SwitchResult {
  session: ServerSession;
  ended: EndedSession;
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Same server as the ACTIVE session: reuse it. Another server: end the old one with REPLACED.
  // resumeSessionId is handled by M1-E3-T5 (reconnect); it is accepted here and not used yet.
  async join(userId: string, serverId: string, _resumeSessionId?: string): Promise<JoinResult> {
    return withTx(this.prisma, async (tx) => {
      await this.lockUser(tx, userId);
      const server = await this.requireActiveServer(tx, serverId);
      const current = await tx.serverSession.findFirst({ where: { userId, status: 'ACTIVE' } });
      if (current && current.serverId === serverId) return { session: current, reused: true };
      await this.assertCapacity(tx, server);
      const ended = current ? await this.endSession(tx, current.id, 'REPLACED') : undefined;
      const session = await this.openSession(tx, userId, serverId);
      return { session, ended, reused: false };
    });
  }

  // Ends one session with the given reason. No-op when the session is not an ACTIVE session of this user.
  async leave(userId: string, sessionId: string, reason: SessionEndReason): Promise<void> {
    await withTx(this.prisma, async (tx) => {
      await this.lockUser(tx, userId);
      const row = await tx.serverSession.findUnique({ where: { id: sessionId } });
      if (!row || row.userId !== userId || row.status !== 'ACTIVE') return;
      await this.endSession(tx, sessionId, reason);
    });
  }

  // Ends the current session with SWITCHED and opens one on the target server, in one transaction.
  async switchTo(userId: string, currentSessionId: string, targetServerId: string): Promise<SwitchResult> {
    return withTx(this.prisma, async (tx) => {
      await this.lockUser(tx, userId);
      const current = await tx.serverSession.findUnique({ where: { id: currentSessionId } });
      if (!current || current.userId !== userId || current.status !== 'ACTIVE') {
        throw new AppError('SESSION_STALE');
      }
      const target = await this.requireActiveServer(tx, targetServerId);
      if (target.id === current.serverId) throw new AppError('ALREADY_IN_SERVER');
      await this.assertCapacity(tx, target);
      const ended = await this.endSession(tx, current.id, 'SWITCHED');
      const session = await this.openSession(tx, userId, targetServerId);
      return { session, ended };
    });
  }

  // Boot step (M1-E3-T5 registers it): ends all ACTIVE sessions with SERVER_RESTART. Returns the count.
  async endAllOnBoot(): Promise<number> {
    return withTx(this.prisma, async (tx) => {
      const res = await tx.serverSession.updateMany({
        where: { status: 'ACTIVE' },
        data: { status: 'ENDED', endReason: 'SERVER_RESTART', endedAt: this.clock.now() },
      });
      return res.count;
    });
  }

  // Command guard (§3.5.3): FOR SHARE on the session row. Waits for a switch that holds it exclusively,
  // and fails with SESSION_STALE when the session is no longer ACTIVE or is on another server.
  async assertSessionActive(tx: Tx, ctx: ServerContext): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string; serverId: string }[]>`
      SELECT status, "serverId" FROM "ServerSession" WHERE id = ${ctx.sessionId}::uuid FOR SHARE`;
    const row = rows[0];
    if (!row || row.status !== 'ACTIVE' || row.serverId !== ctx.serverId) throw new AppError('SESSION_STALE');
  }

  // Transaction-scoped advisory lock for one user (§3.6.1, level L1).
  private async lockUser(tx: Tx, userId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`session:${userId}`}, 0))`;
  }

  private async requireActiveServer(tx: Tx, serverId: string): Promise<GameServer> {
    const server = await tx.gameServer.findUnique({ where: { id: serverId } });
    if (!server) throw new AppError('SERVER_NOT_FOUND');
    if (server.status !== 'ACTIVE') throw new AppError('SERVER_NOT_ACTIVE');
    return server;
  }

  // Counts ACTIVE sessions on the server (no presence store yet, M1-E4-T3). At hardCap: SERVER_FULL.
  private async assertCapacity(tx: Tx, server: GameServer): Promise<void> {
    const online = await tx.serverSession.count({ where: { serverId: server.id, status: 'ACTIVE' } });
    if (online >= server.hardCap) throw new AppError('SERVER_FULL');
  }

  private async endSession(tx: Tx, id: string, reason: SessionEndReason): Promise<EndedSession> {
    const row = await tx.serverSession.update({
      where: { id },
      data: { status: 'ENDED', endReason: reason, endedAt: this.clock.now() },
    });
    return { id: row.id, serverId: row.serverId };
  }

  private openSession(tx: Tx, userId: string, serverId: string): Promise<ServerSession> {
    return tx.serverSession.create({ data: { userId, serverId, startedAt: this.clock.now() } });
  }
}
