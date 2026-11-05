import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RealtimePublisher } from '../core/realtime-publisher.js';
import { PresenceStore, type PresenceEntry } from './presence.store.js';
import { WorldTickService } from './world-tick.service.js';

function entry(userId: string, serverId: string, x: number): PresenceEntry {
  return { userId, serverId, sessionId: `sess-${userId}`, x, y: 10, dir: 'up', seq: 1, seatId: null, lastMoveMs: 0 };
}

function setup() {
  const store = new PresenceStore();
  const realtime = { toServerVolatile: vi.fn() };
  const tick = new WorldTickService(store, realtime as unknown as RealtimePublisher);
  return { store, realtime, tick };
}

describe('WorldTickService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches all moved players of one server into one volatile emit', () => {
    const { store, realtime, tick } = setup();
    store.add(entry('a', 's1', 1));
    store.add(entry('b', 's1', 2));
    store.add(entry('c', 's2', 3));
    store.markDirty('a');
    store.markDirty('b');
    store.markDirty('c');
    tick.tick();
    expect(realtime.toServerVolatile).toHaveBeenCalledTimes(2);
    expect(realtime.toServerVolatile).toHaveBeenCalledWith('s1', 'player:moved', {
      moves: [
        { userId: 'a', x: 1, y: 10, dir: 'up', seq: 1 },
        { userId: 'b', x: 2, y: 10, dir: 'up', seq: 1 },
      ],
    });
    expect(realtime.toServerVolatile).toHaveBeenCalledWith('s2', 'player:moved', {
      moves: [{ userId: 'c', x: 3, y: 10, dir: 'up', seq: 1 }],
    });
  });

  it('emits nothing when nothing changed', () => {
    const { store, realtime, tick } = setup();
    store.add(entry('a', 's1', 1));
    tick.tick();
    store.markDirty('a');
    tick.tick();
    tick.tick();
    expect(realtime.toServerVolatile).toHaveBeenCalledTimes(1);
  });

  it('runs on a 100 ms timer and clears it on destroy', () => {
    vi.useFakeTimers();
    const { tick } = setup();
    tick.onModuleInit();
    expect(vi.getTimerCount()).toBe(1);
    tick.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
