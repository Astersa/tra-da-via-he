import { Module } from '@nestjs/common';
import { MovementService } from './movement.service.js';
import { PresenceStore } from './presence.store.js';
import { SeatService } from './seats.service.js';
import { WorldTickService } from './world-tick.service.js';

// Imported by AppModule since M1-E3-T4 (WorldGateway uses PresenceStore and MovementService).
@Module({
  providers: [PresenceStore, MovementService, WorldTickService, SeatService],
  exports: [PresenceStore, MovementService, SeatService],
})
export class WorldModule {}
