export interface ConnectionBinding {
  socketId: string;
  sessionId: string;
}

// Maps each user to the single socket/session currently allowed to act for them.
// In-memory only; a new bind replaces the old one (session:replaced, §3.4.3).
export class ConnectionRegistry {
  private readonly bindings = new Map<string, ConnectionBinding>();

  bind(userId: string, socketId: string, sessionId: string): { previousSocketId?: string } {
    const previous = this.bindings.get(userId);
    this.bindings.set(userId, { socketId, sessionId });
    return previous ? { previousSocketId: previous.socketId } : {};
  }

  current(userId: string): ConnectionBinding | undefined {
    return this.bindings.get(userId);
  }

  // Only the socket that is currently bound may unbind; a stale socket is a no-op.
  unbind(userId: string, socketId: string): boolean {
    const binding = this.bindings.get(userId);
    if (!binding || binding.socketId !== socketId) return false;
    this.bindings.delete(userId);
    return true;
  }

  isCurrent(userId: string, sessionId: string): boolean {
    return this.bindings.get(userId)?.sessionId === sessionId;
  }

  get size(): number {
    return this.bindings.size;
  }
}
