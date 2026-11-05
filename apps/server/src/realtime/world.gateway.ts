import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  EmptySchema,
  getSpawn,
  PlayerInteractReqSchema,
  PlayerMoveReqSchema,
  PlayerSitReqSchema,
  ServerSwitchReqSchema,
  street01Map,
  WorldJoinReqSchema,
  type PlayerInteractReq,
  type PlayerMoveReq,
  type PlayerSitReq,
  type ServerSwitchReq,
  type WorldJoinReq,
  type WorldState,
} from '@tdvh/shared';
import type { Socket } from 'socket.io';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { PrismaService } from '../core/prisma.service.js';
import { REALTIME_PUBLISHER, type RealtimePublisher } from '../core/realtime-publisher.js';
import { ReconnectService } from '../session/reconnect.service.js';
import { SessionEndHooks, type SessionEndedEvent } from '../session/session-end.hooks.js';
import { SessionService } from '../session/session.service.js';
import { MovementService } from '../world/movement.service.js';
import { PresenceStore, type PresenceEntry } from '../world/presence.store.js';
import { SeatService } from '../world/seats.service.js';
import { ConnectionRegistry } from './connection-registry.js';
import { EventRouter, type EventCtx, type SocketData } from './event-router.js';
import { PromiseChainUserMutex } from './user-mutex.js';
import { WorldStateBuilder } from './world-state.builder.js';

// IMPLEMENTATION-PLAN.md §3.4 (world:*, server:switch, player:move, player:interact/sit/stand), §3.5.2, §3.5.3 (M1-E3-T4), §3.5.2 grace (M1-E3-T5), seats and emote (M1-E4-T4).
// A provider, not a second gateway: it only registers its routes on EventRouter. Every route runs through
// EventPipeline (RealtimeGateway) and then inside this user's lock. Events go out only after the DB commit.
@Injectable()
export class WorldGateway implements OnModuleInit {
  private readonly logger = new Logger('WorldGateway');
  // One lock per process. Commands of one user run in order (§3.5.3, first layer).
  private readonly mutex = new PromiseChainUserMutex();
  // Sockets that already have a disconnect listener (a socket can join more than once).
  private readonly watched = new WeakSet<Socket>();

  constructor(
    @Inject(EventRouter) private readonly router: EventRouter,
    @Inject(ConnectionRegistry) private readonly registry: ConnectionRegistry,
    @Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SessionEndHooks) private readonly hooks: SessionEndHooks,
    @Inject(PresenceStore) private readonly presence: PresenceStore,
    @Inject(MovementService) private readonly movement: MovementService,
    @Inject(SeatService) private readonly seats: SeatService,
    @Inject(WorldStateBuilder) private readonly builder: WorldStateBuilder,
    @Inject(ReconnectService) private readonly reconnect: ReconnectService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.hooks.register((e) => this.onSessionEnded(e));
    this.router.register('world:ping', {
      schema: EmptySchema,
      requireSession: false,
      fn: (ctx) => this.locked(ctx, async () => ({})),
    });
    this.router.register('world:join', {
      schema: WorldJoinReqSchema,
      requireSession: false,
      fn: (ctx, req) => this.locked(ctx, () => this.join(ctx, req)),
    });
    this.router.register('world:leave', {
      schema: EmptySchema,
      requireSession: true,
      fn: (ctx) => this.locked(ctx, () => this.leave(ctx)),
    });
    this.router.register('world:resync', {
      schema: EmptySchema,
      requireSession: true,
      fn: (ctx) => this.locked(ctx, () => this.resync(ctx)),
    });
    this.router.register('server:switch', {
      schema: ServerSwitchReqSchema,
      requireSession: true,
      fn: (ctx, req) => this.locked(ctx, () => this.switchServer(ctx, req)),
    });
    this.router.register('player:move', {
      schema: PlayerMoveReqSchema,
      requireSession: true,
      // No ack for player:move. Rejected moves are corrected with player:moved corrected:true.
      fn: (ctx, req) =>
        this.locked(ctx, async () => {
          this.move(ctx, req);
          return {};
        }),
    });
    this.router.register('player:interact', {
      schema: PlayerInteractReqSchema,
      requireSession: true,
      fn: (ctx, req) =>
        this.locked(ctx, async () => {
          this.emote(ctx, req);
          return {};
        }),
    });
    this.router.register('player:sit', {
      schema: PlayerSitReqSchema,
      requireSession: true,
      fn: (ctx, req) => this.locked(ctx, async () => this.sit(ctx, req)),
    });
    this.router.register('player:stand', {
      schema: EmptySchema,
      requireSession: true,
      fn: (ctx) => this.locked(ctx, async () => this.stand(ctx)),
    });
  }

  private locked<T>(ctx: EventCtx, fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(ctx.userId, fn);
  }

  // Checked again inside the user lock. A command queued before a join or switch must not act on the old session.
  private current(ctx: EventCtx): { sessionId: string; serverId: string } {
    const data = ctx.socket.data as SocketData;
    if (!data.sessionId || !data.serverId || !this.registry.isCurrent(ctx.userId, data.sessionId)) {
      throw new AppError('SESSION_STALE');
    }
    return { sessionId: data.sessionId, serverId: data.serverId };
  }

  private async join(ctx: EventCtx, req: WorldJoinReq): Promise<WorldState> {
    const { userId, socket } = ctx;
    const { session, ended, reused } = await this.sessions.join(userId, req.serverId, req.resumeSessionId);

    // The DB commit is done. Registry, rooms, hooks and events follow in the order of §3.5.3.
    // Joining again ends any grace period: the session is bound to a live socket once more.
    const wasWaiting = this.reconnect.pendingFor(userId)?.sessionId === session.id;
    this.reconnect.cancel(userId);
    const { previousSocketId } = this.registry.bind(userId, socket.id, session.id);
    if (previousSocketId && previousSocketId !== socket.id) this.replaceSocket(socket, previousSocketId);
    if (ended) {
      await this.hooks.run({ userId, sessionId: ended.id, serverId: ended.serverId, reason: 'REPLACED' });
    }
    this.enterRoom(socket, session.serverId);
    this.setSocketData(socket, session.id, session.serverId);
    this.watchDisconnect(socket, userId);
    const existing = this.presence.get(userId);
    if (!existing || existing.sessionId !== session.id) {
      this.presence.add(this.spawnEntry(userId, session.serverId, session.id));
    }

    const state = await this.builder.build(userId, session.serverId, session.id);
    if (!reused) this.publisher.toServerExcept(session.serverId, userId, 'player:joined', state.self);
    if (reused && wasWaiting) {
      this.publisher.toServerExcept(session.serverId, userId, 'player:interacted', { userId, state: 'RECONNECTED' });
    }
    return state;
  }

  private async leave(ctx: EventCtx): Promise<Record<string, never>> {
    const { userId, socket } = ctx;
    const cur = this.current(ctx);
    await this.sessions.leave(userId, cur.sessionId, 'LEFT');
    this.registry.unbind(userId, socket.id);
    this.setSocketData(socket, undefined, undefined);
    void socket.leave(`server:${cur.serverId}`);
    await this.hooks.run({ userId, sessionId: cur.sessionId, serverId: cur.serverId, reason: 'LEFT' });
    return {};
  }

  private async resync(ctx: EventCtx): Promise<WorldState> {
    const cur = this.current(ctx);
    return this.builder.build(ctx.userId, cur.serverId, cur.sessionId);
  }

  private async switchServer(ctx: EventCtx, req: ServerSwitchReq): Promise<WorldState> {
    const { userId, socket } = ctx;
    const cur = this.current(ctx);
    const { session, ended } = await this.sessions.switchTo(userId, cur.sessionId, req.targetServerId);

    // Same socket, new session id. The user is never in two server rooms at once.
    this.registry.bind(userId, socket.id, session.id);
    void socket.leave(`server:${ended.serverId}`);
    this.setSocketData(socket, session.id, session.serverId);
    this.watchDisconnect(socket, userId);
    await this.hooks.run({ userId, sessionId: ended.id, serverId: ended.serverId, reason: 'SWITCHED' });
    this.enterRoom(socket, session.serverId);
    this.presence.add(this.spawnEntry(userId, session.serverId, session.id));

    const state = await this.builder.build(userId, session.serverId, session.id);
    this.publisher.toServerExcept(session.serverId, userId, 'player:joined', state.self);
    return state;
  }

  // Accepted only if the socket is the current one, in a session on this server.
  private move(ctx: EventCtx, req: PlayerMoveReq): void {
    const cur = this.current(ctx);
    const entry = this.presence.get(ctx.userId);
    if (!entry || entry.sessionId !== cur.sessionId || entry.serverId !== cur.serverId) return;
    this.movement.apply(entry, req, this.clock.now().getTime());
  }

  // Seated players are checked against their own presence entry, like move (the seat is in that entry).
  private ownEntry(ctx: EventCtx): { cur: { sessionId: string; serverId: string }; entry: PresenceEntry } {
    const cur = this.current(ctx);
    const entry = this.presence.get(ctx.userId);
    if (!entry || entry.sessionId !== cur.sessionId || entry.serverId !== cur.serverId) throw new AppError('SESSION_STALE');
    return { cur, entry };
  }

  // Emote goes to the whole server room, the sender included (§3.4.3). Seated or not.
  private emote(ctx: EventCtx, req: PlayerInteractReq): void {
    const cur = this.current(ctx);
    this.publisher.toServer(cur.serverId, 'player:interacted', { userId: ctx.userId, kind: req.kind });
  }

  private sit(ctx: EventCtx, req: PlayerSitReq): { seatId: string } {
    const { cur, entry } = this.ownEntry(ctx);
    const { seat, changed } = this.seats.sit(entry, req.seatId);
    if (changed) {
      this.publisher.toServer(cur.serverId, 'player:interacted', { userId: ctx.userId, state: 'SIT', seatId: seat.id });
    }
    return { seatId: seat.id };
  }

  private stand(ctx: EventCtx): Record<string, never> {
    const { cur, entry } = this.ownEntry(ctx);
    if (this.seats.stand(entry)) {
      this.publisher.toServer(cur.serverId, 'player:interacted', { userId: ctx.userId, state: 'STAND' });
    }
    return {};
  }

  // Runs for every session that ends (after commit). Presence is removed only for the ended session.
  // The seat is held by the presence entry (SeatService), so removing the entry frees it: every end path frees it.
  // The last position is written before presence is removed (M1-E4-T3: positions reach the DB only here).
  private async onSessionEnded(e: SessionEndedEvent): Promise<void> {
    if (this.reconnect.pendingFor(e.userId)?.sessionId === e.sessionId) this.reconnect.cancel(e.userId);
    const entry = this.presence.get(e.userId);
    if (entry && entry.sessionId === e.sessionId) {
      await this.saveLastPosition(e.sessionId, entry);
      this.presence.remove(e.userId);
    }
    this.publisher.toServerExcept(e.serverId, e.userId, 'player:left', { userId: e.userId, reason: e.reason });
  }

  // A failed write is logged and does not stop the session end (player:left must still go out).
  private async saveLastPosition(sessionId: string, entry: PresenceEntry): Promise<void> {
    try {
      await this.prisma.serverSession.update({
        where: { id: sessionId },
        data: { lastX: entry.x, lastY: entry.y },
      });
    } catch (err) {
      this.logger.error(`save last position failed sessionId=${sessionId}`, err instanceof Error ? err.stack : String(err));
    }
  }

  // Registers the disconnect listener once per socket. Only the bound socket starts a grace period.
  private watchDisconnect(socket: Socket, userId: string): void {
    if (this.watched.has(socket)) return;
    this.watched.add(socket);
    socket.once('disconnect', () => this.onSocketDisconnect(socket, userId));
  }

  // Synchronous on purpose: the binding is read before any later command can change it. A socket that was
  // replaced by a new tab is no longer bound, so its close does nothing (§3.5.2 "Nhiều tab").
  private onSocketDisconnect(socket: Socket, userId: string): void {
    const binding = this.registry.current(userId);
    if (!binding || binding.socketId !== socket.id) return;
    const serverId = (socket.data as SocketData).serverId;
    this.registry.unbind(userId, socket.id);
    this.setSocketData(socket, undefined, undefined);
    if (!serverId) return;
    const sessionId = binding.sessionId;
    this.reconnect.schedule(userId, sessionId, serverId, () =>
      this.mutex.run(userId, () => this.expireGrace(userId, sessionId)),
    );
    this.publisher.toServerExcept(serverId, userId, 'player:interacted', { userId, state: 'DISCONNECTED' });
  }

  // Runs under the user lock. Ends the session only if it is still waiting for a reconnect and nobody is bound.
  private async expireGrace(userId: string, sessionId: string): Promise<void> {
    const pending = this.reconnect.pendingFor(userId);
    if (!pending || pending.sessionId !== sessionId || this.registry.current(userId)) return;
    this.reconnect.cancel(userId);
    await this.sessions.leave(userId, sessionId, 'GRACE_EXPIRED');
    await this.hooks.run({ userId, sessionId, serverId: pending.serverId, reason: 'GRACE_EXPIRED' });
  }

  // The previous tab is told why, then disconnected. It is not reconnected automatically (§3.5.2).
  private replaceSocket(socket: Socket, previousSocketId: string): void {
    const previous = socket.nsp.sockets.get(previousSocketId);
    if (!previous) return;
    previous.emit('session:replaced', { reason: 'NEW_TAB' });
    previous.disconnect(true);
  }

  // Leaves any other server room first, so a socket is in one server room at most.
  private enterRoom(socket: Socket, serverId: string): void {
    const room = `server:${serverId}`;
    for (const r of socket.rooms) {
      if (r.startsWith('server:') && r !== room) void socket.leave(r);
    }
    void socket.join(room);
  }

  private setSocketData(socket: Socket, sessionId: string | undefined, serverId: string | undefined): void {
    const data = socket.data as SocketData;
    data.sessionId = sessionId;
    data.serverId = serverId;
  }

  // Start position is the map spawn. lastMoveMs starts at the join time (§3.9).
  private spawnEntry(userId: string, serverId: string, sessionId: string): PresenceEntry {
    const spawn = getSpawn(street01Map);
    return {
      userId,
      serverId,
      sessionId,
      x: spawn.x,
      y: spawn.y,
      dir: 'down',
      seq: 0,
      seatId: null,
      lastMoveMs: this.clock.now().getTime(),
    };
  }
}
