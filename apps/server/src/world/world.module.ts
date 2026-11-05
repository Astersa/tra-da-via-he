import { Module } from '@nestjs/common';
import { MovementService } from './movement.service.js';
import { PresenceStore } from './presence.store.js';
import { WorldTickService } from './world-tick.service.js';

// Not imported by AppModule yet: wiring belongs to M1-E3-T4 (gateway handlers).
@Module({
  providers: [PresenceStore, MovementService, WorldTickService],
  exports: [PresenceStore, MovementService],
})
export class WorldModule {}
