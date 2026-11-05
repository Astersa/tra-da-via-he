import { getSpawn, isWalkable, street01Map, TILE_SIZE, type PlayerMoveReq } from '@tdvh/shared';
import { describe, expect, it, vi } from 'vitest';
import type { RealtimePublisher } from '../core/realtime-publisher.js';
import { MovementService } from './movement.service.js';
import { PresenceStore, type PresenceEntry } from './presence.store.js';

type Pt = { x: number; y: number };

// Tile centers that are walkable on the shared street-01 map.
const centers: Pt[] = [];
for (let ty = 0; ty < street01Map.height; ty++) {
  for (let tx = 0; tx < street01Map.width; tx++) {
    const x = tx * TILE_SIZE + TILE_SIZE / 2;
    const y = ty * TILE_SIZE + TILE_SIZE / 2;
    if (isWalkable(street01Map, x, y)) centers.push({ x, y });
  }
}
const spawn = getSpawn(street01Map);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function walkableAt(min: number, max: number): Pt {
  const hit = centers.find((c) => dist(c, spawn) >= min && dist(c, spawn) <= max);
  if (!hit) throw new Error(`no walkable tile at ${min}..${max} px from spawn`);
  return hit;
}

// A walkable tile center with a wall tile center directly to its right.
function wallPair(): { walk: Pt; wall: Pt } {
  for (let ty = 0; ty < street01Map.height; ty++) {
    for (let tx = 0; tx < street01Map.width - 1; tx++) {
      const walk = { x: tx * TILE_SIZE + 16, y: ty * TILE_SIZE + 16 };
      const wall = { x: walk.x + TILE_SIZE, y: walk.y };
      if (isWalkable(street01Map, walk.x, walk.y) && !isWalkable(street01Map, wall.x, wall.y)) return { walk, wall };
    }
  }
  throw new Error('no wall pair on map');
}

function setup(start: Pt, seatId: string | null = null) {
  const store = new PresenceStore();
  const realtime = { toUser: vi.fn(), toServerVolatile: vi.fn() };
  const service = new MovementService(store, realtime as unknown as RealtimePublisher);
  const player: PresenceEntry = {
    userId: 'u1', serverId: 's1', sessionId: 'sess1', x: start.x, y: start.y,
    dir: 'down', seq: 0, seatId, lastMoveMs: 0,
  };
  store.add(player);
  return { store, realtime, service, player };
}

function req(p: Pt, seq: number): PlayerMoveReq {
  return { x: p.x, y: p.y, dir: 'right', seq };
}

describe('MovementService.apply', () => {
  it('accepts a move at the allowed speed', () => {
    const target = walkableAt(100, 200);
    const { service, player, realtime, store } = setup(spawn);
    // 1000 ms allows 160 * 1 * 1.25 + 16 = 216 px.
    expect(service.apply(player, req(target, 1), 1000)).toBe('ok');
    expect(player.x).toBe(target.x);
    expect(player.y).toBe(target.y);
    expect(realtime.toUser).not.toHaveBeenCalled();
    expect(store.drainDirty().map((e) => e.userId)).toEqual(['u1']);
  });

  it('corrects an instant teleport back to the old position', () => {
    const far = walkableAt(400, 10_000);
    const { service, player, realtime, store } = setup(spawn);
    // 100 ms allows 160 * 0.1 * 1.25 + 16 = 36 px.
    expect(service.apply(player, req(far, 1), 100)).toBe('corrected');
    expect(player.x).toBe(spawn.x);
    expect(player.y).toBe(spawn.y);
    expect(realtime.toUser).toHaveBeenCalledWith('u1', 'player:moved', {
      moves: [{ userId: 'u1', x: spawn.x, y: spawn.y, dir: 'down', seq: 1, corrected: true }],
    });
    expect(realtime.toServerVolatile).not.toHaveBeenCalled();
    expect(store.drainDirty()).toEqual([]);
  });

  it('corrects a move into a wall', () => {
    const { walk, wall } = wallPair();
    const { service, player, realtime } = setup(walk);
    expect(service.apply(player, req(wall, 1), 1000)).toBe('corrected');
    expect(player.x).toBe(walk.x);
    expect(player.y).toBe(walk.y);
    expect(realtime.toUser).toHaveBeenCalledTimes(1);
  });

  it('ignores a request with an old or repeated seq', () => {
    const a = walkableAt(100, 200);
    const b = walkableAt(20, 60);
    const { service, player, realtime, store } = setup(spawn);
    expect(service.apply(player, req(a, 5), 1000)).toBe('ok');
    store.drainDirty();
    expect(service.apply(player, req(b, 3), 2000)).toBe('ok');
    expect(service.apply(player, req(b, 5), 2000)).toBe('ok');
    expect(player.x).toBe(a.x);
    expect(player.y).toBe(a.y);
    expect(player.seq).toBe(5);
    expect(realtime.toUser).not.toHaveBeenCalled();
    expect(store.drainDirty()).toEqual([]);
  });

  it('ignores moves while seated', () => {
    const target = walkableAt(20, 60);
    const { service, player, realtime, store } = setup(spawn, 'seat-1');
    expect(service.apply(player, req(target, 1), 1000)).toBe('ok');
    expect(player.x).toBe(spawn.x);
    expect(player.seq).toBe(0);
    expect(realtime.toUser).not.toHaveBeenCalled();
    expect(store.drainDirty()).toEqual([]);
  });
});
