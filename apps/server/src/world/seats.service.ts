import { Inject, Injectable } from '@nestjs/common';
import { getSeats, street01Map, type Seat } from '@tdvh/shared';
import { AppError } from '../core/errors.js';
import { PresenceStore, type PresenceEntry } from './presence.store.js';

// IMPLEMENTATION-PLAN.md §3.4.2 (player:sit, player:stand), §3.5.2, M1-E4-T4.
// Seats come from the map. Occupancy is PresenceStore.entry.seatId: in memory, per server process, no DB.
// A seat is free as soon as its presence entry is removed. That happens when the session ends
// (SessionEndHooks: leave, switch, replaced, grace expiry). During a grace period the entry stays, so the seat stays.
export const SEAT_REACH_PX = 48;

@Injectable()
export class SeatService {
  private readonly byId: Map<string, Seat>;

  constructor(@Inject(PresenceStore) private readonly presence: PresenceStore) {
    this.byId = new Map(getSeats(street01Map).map((s) => [s.id, s]));
  }

  find(seatId: string): Seat | undefined {
    return this.byId.get(seatId);
  }

  // Synchronous on purpose: the check and the write happen in one step, so two sits on the same seat in this
  // process cannot both succeed. Checks, in order: SEAT_NOT_FOUND, SEAT_TAKEN, TOO_FAR (distance from the
  // server position). Nothing changes when a check fails. Sitting on the seat already held is a no-op (changed=false).
  // Sitting on another seat while seated frees the old one, because the entry only holds one seat.
  sit(entry: PresenceEntry, seatId: string): { seat: Seat; changed: boolean } {
    const seat = this.find(seatId);
    if (!seat) throw new AppError('SEAT_NOT_FOUND');
    if (entry.seatId === seat.id) return { seat, changed: false };
    const holder = this.presence.listByServer(entry.serverId).find((e) => e.seatId === seat.id);
    if (holder) throw new AppError('SEAT_TAKEN');
    if (Math.hypot(seat.x - entry.x, seat.y - entry.y) > SEAT_REACH_PX) throw new AppError('TOO_FAR');

    entry.seatId = seat.id;
    entry.x = seat.x;
    entry.y = seat.y;
    this.presence.markDirty(entry.userId);
    return { seat, changed: true };
  }

  // Returns true when the player was seated and is now standing. Standing when not seated is a no-op.
  stand(entry: PresenceEntry): boolean {
    if (entry.seatId === null) return false;
    entry.seatId = null;
    return true;
  }
}
