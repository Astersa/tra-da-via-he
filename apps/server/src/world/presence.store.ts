import { Injectable } from '@nestjs/common';
import type { Dir } from '@tdvh/shared';

// IMPLEMENTATION-PLAN.md §3.9, M1-E4-T3. In-memory presence of players in the world.
// Lives in this process only; positions reach the DB when the session ends (not here).
export interface PresenceEntry {
  userId: string;
  serverId: string;
  sessionId: string;
  x: number;
  y: number;
  dir: Dir;
  // Last accepted seq. Requests with seq <= this are ignored.
  seq: number;
  // Null when standing. Set by the seat service (M1-E4-T4).
  seatId: string | null;
  // Time (ms) of the last accepted or corrected move, or the join time.
  lastMoveMs: number;
}

@Injectable()
export class PresenceStore {
  private readonly entries = new Map<string, PresenceEntry>();
  private readonly dirty = new Set<string>();

  add(entry: PresenceEntry): void {
    this.entries.set(entry.userId, entry);
  }

  // Removes the entry and any pending dirty mark for this user.
  remove(userId: string): PresenceEntry | undefined {
    const entry = this.entries.get(userId);
    this.entries.delete(userId);
    this.dirty.delete(userId);
    return entry;
  }

  get(userId: string): PresenceEntry | undefined {
    return this.entries.get(userId);
  }

  listByServer(serverId: string): PresenceEntry[] {
    return [...this.entries.values()].filter((e) => e.serverId === serverId);
  }

  countByServer(serverId: string): number {
    let count = 0;
    for (const e of this.entries.values()) if (e.serverId === serverId) count++;
    return count;
  }

  // Marks a user whose position changed since the last tick. Unknown users are ignored.
  markDirty(userId: string): void {
    if (this.entries.has(userId)) this.dirty.add(userId);
  }

  // Returns the entries changed since the last drain and clears the dirty set.
  drainDirty(): PresenceEntry[] {
    const out: PresenceEntry[] = [];
    for (const userId of this.dirty) {
      const entry = this.entries.get(userId);
      if (entry) out.push(entry);
    }
    this.dirty.clear();
    return out;
  }
}
