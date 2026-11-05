import { Injectable, Logger } from '@nestjs/common';
import type { ServerEvent } from '@tdvh/shared';
import type { Server } from 'socket.io';
import type { RealtimePublisher, ServerPayload } from '../core/realtime-publisher.js';

// Minimal view of a socket.io broadcast target. Event names are checked by ServerEvent at the call site.
interface Emitter {
  emit(ev: string, payload: unknown): void;
  except(room: string): Emitter;
}

// Socket.IO implementation of RealtimePublisher. No-op until the gateway attaches the server.
@Injectable()
export class SocketRealtimePublisher implements RealtimePublisher {
  private readonly logger = new Logger('RealtimePublisher');
  private server?: Server;

  attach(server: Server): void {
    this.server = server;
  }

  toUser<E extends ServerEvent>(userId: string, ev: E, p: ServerPayload<E>): void {
    this.target(`user:${userId}`)?.emit(ev, p);
  }

  toServer<E extends ServerEvent>(serverId: string, ev: E, p: ServerPayload<E>): void {
    this.target(`server:${serverId}`)?.emit(ev, p);
  }

  toServerVolatile<E extends ServerEvent>(serverId: string, ev: E, p: ServerPayload<E>): void {
    this.server?.volatile.to(`server:${serverId}`).emit(ev, p);
  }

  toServerExcept<E extends ServerEvent>(serverId: string, userId: string, ev: E, p: ServerPayload<E>): void {
    this.target(`server:${serverId}`)?.except(`user:${userId}`).emit(ev, p);
  }

  toShopStaff<E extends ServerEvent>(shopId: string, ev: E, p: ServerPayload<E>): void {
    this.target(`shop-staff:${shopId}`)?.emit(ev, p);
  }

  toLobby<E extends ServerEvent>(ev: E, p: ServerPayload<E>): void {
    this.target('lobby')?.emit(ev, p);
  }

  disconnectUser(userId: string, reason: string): void {
    this.logger.log(`disconnect user sockets reason=${reason}`);
    this.server?.in(`user:${userId}`).disconnectSockets(true);
  }

  joinShopStaff(userId: string, shopId: string): void {
    this.server?.in(`user:${userId}`).socketsJoin(`shop-staff:${shopId}`);
  }

  leaveShopStaff(userId: string, shopId: string): void {
    this.server?.in(`user:${userId}`).socketsLeave(`shop-staff:${shopId}`);
  }

  private target(room: string): Emitter | undefined {
    return this.server?.to(room) as unknown as Emitter | undefined;
  }
}
