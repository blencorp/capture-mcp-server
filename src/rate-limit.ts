import { ExpiringMap } from './auth/expiring-map.js';

/** Most addresses tracked at once; at the ceiling the least recently counted one is forgotten. */
const MAX_TRACKED_CLIENTS = 50_000;

/**
 * A token-bucket request budget per client address, in memory and per instance: each address may
 * burst up to `burst` requests and then sustain `rps` per second. A bucket idle for long enough
 * to refill completely is the same as a new one, so it is dropped.
 */
export class RequestBudget {
  private readonly buckets: ExpiringMap<{ tokens: number; updatedAtMs: number }>;
  private readonly idleMs: number;

  constructor(
    private readonly rps: number,
    private readonly burst: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!(rps > 0) || !(burst >= 1) || !Number.isFinite(rps) || !Number.isFinite(burst)) {
      throw new Error('A request budget needs a positive rate and a burst of at least 1');
    }
    this.idleMs = Math.ceil((burst / rps) * 1000);
    this.buckets = new ExpiringMap(MAX_TRACKED_CLIENTS, now);
  }

  /**
   * Spends one request for `client`. Returns 0 when it was allowed, otherwise the seconds to wait
   * before one is (for `Retry-After`).
   */
  spend(client: string): number {
    const now = this.now();
    const bucket = this.buckets.get(client) ?? { tokens: this.burst, updatedAtMs: now };
    const tokens = Math.min(this.burst, bucket.tokens + ((now - bucket.updatedAtMs) / 1000) * this.rps);
    const allowed = tokens >= 1;
    const remaining = allowed ? tokens - 1 : tokens;
    this.buckets.set(client, { tokens: remaining, updatedAtMs: now }, now + this.idleMs);
    return allowed ? 0 : Math.ceil((1 - tokens) / this.rps);
  }
}
