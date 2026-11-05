export interface UserMutex {
  run<T>(userId: string, fn: () => Promise<T>): Promise<T>;
}

// Serialises work per user with a promise chain. A failing fn only rejects its own
// call; the chain continues. The per-user entry is removed once its queue drains.
export class PromiseChainUserMutex implements UserMutex {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(userId) ?? Promise.resolve();
    const result = prev.then(fn);
    // Tail never rejects, so one failing call cannot poison the next one.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(userId, tail);
    void tail.then(() => {
      if (this.tails.get(userId) === tail) this.tails.delete(userId);
    });
    return result;
  }

  get size(): number {
    return this.tails.size;
  }
}
