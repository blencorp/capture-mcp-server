/**
 * A map whose entries expire and whose size has a ceiling, for state a hosted instance keeps in
 * memory on behalf of anonymous callers (client registrations, pending authorizations, codes,
 * revocations, request budgets). Without both limits that state would grow with request volume.
 *
 * Entries are expected to share a lifetime, so they expire in insertion order and expired ones are
 * dropped from the front in constant time per call. An entry with a longer lifetime than those
 * before it is only dropped when it reaches the front, but `get` never returns an expired entry.
 * At the ceiling expired entries go first (wherever they sit), then the oldest live entry: a flood
 * costs the oldest state, never unbounded memory. Mixed lifetimes belong in separate maps, so a
 * short-lived flood cannot evict a long-lived entry.
 */
export class ExpiringMap<V> {
  private readonly entries = new Map<string, { value: V; expiresAtMs: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('ExpiringMap needs a positive integer maxEntries');
    }
  }

  get size(): number {
    this.dropExpired();
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V, expiresAtMs: number): void {
    this.entries.delete(key); // re-inserting moves the key to the newest position
    this.dropExpired();
    if (this.entries.size >= this.maxEntries) this.dropAllExpired(); // an expired entry is evicted before any live one
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAtMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drops every expired entry wherever it sits; linear, so only used when the map is full. */
  private dropAllExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(key);
    }
  }

  /** Drops expired entries from the oldest end, stopping at the first one still live. */
  private dropExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs > now) break;
      this.entries.delete(key);
    }
  }
}
