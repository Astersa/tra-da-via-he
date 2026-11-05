import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  EmptySchema,
  getSpawn,
  PlayerMoveReqSchema,
  ServerSwitchReqSchema,
  street01Map,
  WorldJoinReqSchema,
  type PlayerMoveReq,
  type ServerSwitchReq,
  type WorldJoinReq,
  type WorldState,
} from '@tdvh/shared';
import type { Socket } from 'socket.io';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { REALTIME_PUBLISHER, type RealtimePublisher } from '../core/realtime-publisher.js';
import { SessionEndHooks, type SessionEndedEvent } from '../session/session-end.hooks.js';
import { SessionService } from '../session/session.service.js';
import { MovementService } from '../world/movement.service.js';
import { PresenceStore, type PresenceEntry } from '../world/presence.store.js';
import { ConnectionRegistry } from './connection-registry.js';
import { EventRouter, type EventCtx, type SocketData } from './event-router.js';
import { PromiseChainUserMutex } from './user-mutex.js';
import { WorldStateBuilder } from './world-state.builder.js';

// IMPLEMENTATION-PLAN.md §3.4 (world:*, server:switch, player:move), §3.5.2, §3.5.3 (M1-E3-T4).
// A provider, not a second gateway: it only registers its routes on EventRouter. Every route runs through
// EventPipeline (RealtimeGateway) and then inside this user's lock. Events go out only after the DB commit.
@Injectable()
export class WorldGateway implements OnModuleInit {
  // One lock per process. Commands of one user run in order (§3.5.3, first layer).
  private readonly mutex = new PromiseChainUserMutex();

  constructor(
    @Inject(EventRouter) private readonly router: EventRouter,
    @Inject(ConnectionRegistry) private readonly registry: ConnectionRegistry,
    @Inject(REALTIME_PUBLISHER) private readonly publisher: RealtimePublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SessionEndHooks) private readonly hooks: SessionEndHooks,
    @Inject(PresenceStore) private readonly presence: PresenceStore,
    @Inject(MovementService) private readonly movement: MovementService,
    @Inject(WorldStateBuilder) private readonly builder: WorldStateBuilder,
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
    const { previousSocketId } = this.registry.bind(userId, socket.id, session.id);
    if (previousSocketId && previousSocketId !== socket.id) this.replaceSocket(socket, previousSocketId);
    if (ended) {
      await this.hooks.run({ userId, sessionId: ended.id, serverId: ended.serverId, reason: 'REPLACED' });
    }
    this.enterRoom(socket, session.serverId);
    this.setSocketData(socket, session.id, session.serverId);
    const existing = this.presence.get(userId);
    if (!existing || existing.sessionId !== session.id) {
      this.presence.add(this.spawnEntry(userId, session.serverId, session.id));
    }

    const state = await this.builder.build(userId, session.serverId, session.id);
    if (!reused) this.publisher.toServerExcept(session.serverId, userId, 'player:joined', state.self);
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

  // Runs for every session that ends (after commit). Presence is removed only for the ended session.
  private async onSessionEnded(e: SessionEndedEvent): Promise<void> {
    const entry = this.presence.get(e.userId);
    if (entry && entry.sessionId === e.sessionId) this.presence.remove(e.userId);
    this.publisher.toServerExcept(e.serverId, e.userId, 'player:left', { userId: e.userId, reason: e.reason });
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
