import { InMemoryRateLimiter } from './rate-limiter.js';

const cfg = { capacity: 3, refillPerSec: 1 };

describe('InMemoryRateLimiter (token bucket, fake time)', () => {
  it('starts full: capacity calls succeed immediately', () => {
    const rl = new InMemoryRateLimiter();
    expect(rl.take('k', cfg, 0)).toEqual({ ok: true });
    expect(rl.take('k', cfg, 0)).toEqual({ ok: true });
    expect(rl.take('k', cfg, 0)).toEqual({ ok: true });
  });

  it('when empty, rejects with retryAfterMs until one token refills', () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) rl.take('k', cfg, 0);
    // refillPerSec 1 => one token every 1000 ms; at t=0 the next token is 1000 ms away.
    expect(rl.take('k', cfg, 0)).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(rl.take('k', cfg, 400)).toEqual({ ok: false, retryAfterMs: 600 });
    expect(rl.take('k', cfg, 1000)).toEqual({ ok: true });
  });

  it('refill never exceeds capacity', () => {
    const rl = new InMemoryRateLimiter();
    rl.take('k', cfg, 0);
    // A very long idle period must not grant more than capacity tokens.
    for (let i = 0; i < 3; i++) expect(rl.take('k', cfg, 1_000_000)).toEqual({ ok: true });
    expect(rl.take('k', cfg, 1_000_000).ok).toBe(false);
  });

  it('keys are isolated from each other', () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) rl.take('a', cfg, 0);
    expect(rl.take('a', cfg, 0).ok).toBe(false);
    expect(rl.take('b', cfg, 0)).toEqual({ ok: true });
  });

  it('drops buckets that have refilled to full, so memory does not grow without bound', () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < 1000; i++) rl.take(`ip-${i}`, cfg, 0);
    expect(rl.size).toBe(1000);
    // Long after every bucket would be full again, any take triggers the sweep.
    rl.take('trigger', cfg, 10_000_000);
    expect(rl.size).toBe(1); // only 'trigger' remains, and it is partly used
  });

  it('a dropped bucket behaves exactly like a fresh full bucket', () => {
    const rl = new InMemoryRateLimiter();
    for (let i = 0; i < 3; i++) rl.take('k', cfg, 0);
    rl.take('other', cfg, 10_000_000); // sweeps 'k'
    expect(rl.take('k', cfg, 10_000_000)).toEqual({ ok: true });
  });
});
