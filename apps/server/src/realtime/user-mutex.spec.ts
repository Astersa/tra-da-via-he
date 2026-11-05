import { PromiseChainUserMutex } from './user-mutex.js';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PromiseChainUserMutex', () => {
  it('runs 100 calls for the same user strictly one at a time, in order', async () => {
    const mutex = new PromiseChainUserMutex();
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];

    const calls = Array.from({ length: 100 }, (_, i) =>
      mutex.run('u1', async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        order.push(i);
        running--;
        return i;
      }),
    );

    const results = await Promise.all(calls);
    expect(maxRunning).toBe(1);
    expect(order).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(results).toEqual(order);
  });

  it('different users run in parallel', async () => {
    const mutex = new PromiseChainUserMutex();
    const gate = deferred();
    let bStarted = false;

    const a = mutex.run('A', () => gate.promise);
    const b = mutex.run('B', async () => {
      bStarted = true;
    });

    await b;
    expect(bStarted).toBe(true); // B did not wait for A
    gate.resolve();
    await a;
  });

  it('a throwing fn rejects its own call but does not block the next call', async () => {
    const mutex = new PromiseChainUserMutex();
    const first = mutex.run('u1', async () => {
      throw new Error('boom');
    });
    const second = mutex.run('u1', async () => 'ok');

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
  });

  it('removes its per-user entry once the queue is empty', async () => {
    const mutex = new PromiseChainUserMutex();
    await Promise.all([
      mutex.run('u1', async () => 1),
      mutex.run('u1', async () => 2),
      mutex.run('u2', async () => 3),
    ]);
    // Let the cleanup callbacks settle.
    await new Promise((r) => setImmediate(r));
    expect(mutex.size).toBe(0);
  });

  it('removes the entry even when the last call rejects', async () => {
    const mutex = new PromiseChainUserMutex();
    await expect(
      mutex.run('u1', async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    await new Promise((r) => setImmediate(r));
    expect(mutex.size).toBe(0);
  });
});
