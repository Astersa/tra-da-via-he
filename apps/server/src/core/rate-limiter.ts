export interface RateLimitConfig {
  capacity: number;
  refillPerSec: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

// Time is passed in by the caller (nowMs) so tests can use fake time.
export interface RateLimiter {
  take(key: string, cfg: RateLimitConfig, nowMs: number): RateLimitResult;
}

interface Bucket {
  tokens: number;
  lastMs: number;
  // Instant at which the bucket is full again; after this it equals a fresh bucket.
  fullAtMs: number;
}

// How often the map is scanned for buckets that have refilled to full.
const SWEEP_INTERVAL_MS = 60_000;

// In-memory token bucket. Process-local state: lost on restart, by design (§3.9).
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepMs = 0;

  take(key: string, cfg: RateLimitConfig, nowMs: number): RateLimitResult {
    this.sweepIfDue(nowMs);

    const existing = this.buckets.get(key);
    const bucket: Bucket = existing ?? { tokens: cfg.capacity, lastMs: nowMs, fullAtMs: nowMs };
    const elapsedSec = Math.max(0, nowMs - bucket.lastMs) / 1000;
    bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsedSec * cfg.refillPerSec);
    bucket.lastMs = nowMs;

    let result: RateLimitResult;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      result = { ok: true };
    } else {
      const msPerToken = 1000 / cfg.refillPerSec;
      result = { ok: false, retryAfterMs: Math.ceil((1 - bucket.tokens) * msPerToken) };
    }
    bucket.fullAtMs = nowMs + Math.ceil(((cfg.capacity - bucket.tokens) * 1000) / cfg.refillPerSec);
    this.buckets.set(key, bucket);
    return result;
  }

  get size(): number {
    return this.buckets.size;
  }

  // Dropping a bucket that is already full is exact: a missing key starts full too.
  private sweepIfDue(nowMs: number): void {
    if (nowMs - this.lastSweepMs < SWEEP_INTERVAL_MS) return;
    this.lastSweepMs = nowMs;
    for (const [key, bucket] of this.buckets) {
      if (nowMs >= bucket.fullAtMs) this.buckets.delete(key);
    }
  }
}
