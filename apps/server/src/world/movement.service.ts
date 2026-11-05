import { Inject, Injectable } from '@nestjs/common';
import { isWalkable, street01Map, type PlayerMoveReq } from '@tdvh/shared';
import { REALTIME_PUBLISHER, type RealtimePublisher } from '../core/realtime-publisher.js';
import { PresenceStore, type PresenceEntry } from './presence.store.js';

// IMPLEMENTATION-PLAN.md §3.4 (player:move), M1-E4-T3. Server is the source of truth: the client position is a request.
export const MAX_SPEED_PX_PER_SEC = 160;
const SLACK_FACTOR = 1.25;
const SLACK_PX = 16;

export type MoveResult = 'ok' | 'corrected';

@Injectable()
export class MovementService {
  constructor(
    @Inject(PresenceStore) private readonly store: PresenceStore,
    @Inject(REALTIME_PUBLISHER) private readonly realtime: RealtimePublisher,
  ) {}

  // Returns 'corrected' when the request was rejected and the player was put back at the old position
  // (the correction is sent privately with corrected: true). Returns 'ok' otherwise, including when the
  // request was ignored (stale seq, or seated): the state is then left unchanged and nothing is sent.
  apply(player: PresenceEntry, req: PlayerMoveReq, nowMs: number): MoveResult {
    if (player.seatId !== null) return 'ok';
    if (req.seq <= player.seq) return 'ok';

    const dtSec = Math.max(0, nowMs - player.lastMoveMs) / 1000;
    const maxDist = MAX_SPEED_PX_PER_SEC * dtSec * SLACK_FACTOR + SLACK_PX;
    const dist = Math.hypot(req.x - player.x, req.y - player.y);
    const valid = dist <= maxDist && isWalkable(street01Map, req.x, req.y);

    player.seq = req.seq;
    player.lastMoveMs = nowMs;
    if (valid) {
      player.x = req.x;
      player.y = req.y;
      player.dir = req.dir;
      this.store.markDirty(player.userId);
      return 'ok';
    }

    this.realtime.toUser(player.userId, 'player:moved', {
      moves: [{ userId: player.userId, x: player.x, y: player.y, dir: player.dir, seq: player.seq, corrected: true }],
    });
    return 'corrected';
  }
}
