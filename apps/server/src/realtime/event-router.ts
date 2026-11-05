import { Injectable } from '@nestjs/common';
import type { ClientEvent } from '@tdvh/shared';
import type { Socket } from 'socket.io';
import type { ZodType } from 'zod';

// socket.data is set only by the server: auth sets userId, world:join sets sessionId.
export interface SocketData {
  userId?: string;
  sessionId?: string;
}

// Built from socket.data, never from the payload (§3.4).
export interface EventCtx {
  userId: string;
  socket: Socket;
  requestId: string;
}

export interface EventRoute<Req = unknown, Res = unknown> {
  schema: ZodType<Req>;
  requireSession: boolean;
  fn: (ctx: EventCtx, req: Req) => Promise<Res>;
}

// Maps a client event to its handler. Handlers are registered by feature modules.
@Injectable()
export class EventRouter {
  // Stored with erased types; each route is parsed by its own schema at dispatch time.
  private readonly routes = new Map<ClientEvent, EventRoute<never, unknown>>();

  register<Req, Res>(event: ClientEvent, route: EventRoute<Req, Res>): void {
    if (this.routes.has(event)) throw new Error(`event route registered twice: ${event}`);
    this.routes.set(event, route as unknown as EventRoute<never, unknown>);
  }

  get(event: ClientEvent): EventRoute<never, unknown> | undefined {
    return this.routes.get(event);
  }
}
