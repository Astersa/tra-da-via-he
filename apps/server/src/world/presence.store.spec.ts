import { describe, expect, it } from 'vitest';
import { PresenceStore, type PresenceEntry } from './presence.store.js';

function entry(userId: string, serverId = 's1'): PresenceEntry {
  return { userId, serverId, sessionId: `sess-${userId}`, x: 0, y: 0, dir: 'down', seq: 0, seatId: null, lastMoveMs: 0 };
}

describe('PresenceStore', () => {
  it('add, get, list and count by server', () => {
    const store = new PresenceStore();
    store.add(entry('a'));
    store.add(entry('b'));
    store.add(entry('c', 's2'));
    expect(store.get('a')?.userId).toBe('a');
    expect(store.listByServer('s1').map((e) => e.userId).sort()).toEqual(['a', 'b']);
    expect(store.countByServer('s1')).toBe(2);
    expect(store.countByServer('s2')).toBe(1);
    expect(store.countByServer('none')).toBe(0);
  });

  it('remove deletes the entry and its dirty mark', () => {
    const store = new PresenceStore();
    store.add(entry('a'));
    store.markDirty('a');
    expect(store.remove('a')?.userId).toBe('a');
    expect(store.get('a')).toBeUndefined();
    expect(store.countByServer('s1')).toBe(0);
    expect(store.drainDirty()).toEqual([]);
  });

  it('markDirty ignores unknown users and drainDirty clears the set', () => {
    const store = new PresenceStore();
    store.add(entry('a'));
    store.markDirty('ghost');
    store.markDirty('a');
    store.markDirty('a');
    expect(store.drainDirty().map((e) => e.userId)).toEqual(['a']);
    expect(store.drainDirty()).toEqual([]);
  });
});
