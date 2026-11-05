import { Global, Module } from '@nestjs/common';
import { REALTIME_PUBLISHER } from '../core/realtime-publisher.js';
import { ConnectionRegistry } from './connection-registry.js';
import { createEventRateLimiter, EVENT_RATE_LIMITER, EventPipeline } from './event-pipeline.js';
import { EventRouter } from './event-router.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { SocketAuth } from './socket-auth.js';
import { SocketRealtimePublisher } from './socket-realtime-publisher.js';

// Global so services can inject REALTIME_PUBLISHER without importing realtime/ (§3.1).
@Global()
@Module({
  providers: [
    ConnectionRegistry,
    EventRouter,
    EventPipeline,
    // Factory, not value: each app instance gets its own limiter (process-local state).
    { provide: EVENT_RATE_LIMITER, useFactory: createEventRateLimiter },
    SocketAuth,
    SocketRealtimePublisher,
    { provide: REALTIME_PUBLISHER, useExisting: SocketRealtimePublisher },
    RealtimeGateway,
  ],
  exports: [ConnectionRegistry, EventRouter, REALTIME_PUBLISHER],
})
export class RealtimeModule {}
