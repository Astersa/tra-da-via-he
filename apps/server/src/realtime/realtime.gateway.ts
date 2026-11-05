import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { ClientEventSchemas, type Ack, type ClientEvent } from '@tdvh/shared';
import type { Server, Socket } from 'socket.io';
import { EventPipeline, type AckFn } from './event-pipeline.js';
import { EventRouter, type SocketData } from './event-router.js';
import { SocketAuth } from './socket-auth.js';
import { SocketRealtimePublisher } from './socket-realtime-publisher.js';

// Connection: auth in middleware, then lobby and user rooms. Each client event goes through EventPipeline.
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('RealtimeGateway');

  constructor(
    private readonly auth: SocketAuth,
    private readonly router: EventRouter,
    private readonly pipeline: EventPipeline,
    private readonly publisher: SocketRealtimePublisher,
  ) {}

  afterInit(server: Server): void {
    server.use(this.auth.middleware());
    this.publisher.attach(server);
  }

  handleConnection(client: Socket): void {
    const { userId } = client.data as SocketData;
    if (!userId) {
      client.disconnect(true);
      return;
    }
    void client.join(['lobby', `user:${userId}`]);
    for (const event of Object.keys(ClientEventSchemas) as ClientEvent[]) {
      client.on(event, (raw: unknown, ack?: AckFn) => this.dispatch(client, event, raw, ack));
    }
  }

  private dispatch(client: Socket, event: ClientEvent, raw: unknown, ack: AckFn | undefined): void {
    const route = this.router.get(event);
    if (!route) {
      const res: Ack<unknown> = { ok: false, error: { code: 'NOT_FOUND', message: 'not found', retryable: false } };
      if (typeof ack === 'function') ack(res);
      return;
    }
    void this.pipeline.handleEvent(client, event, raw, ack, route, route.fn);
  }
}
