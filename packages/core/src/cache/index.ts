import type { Clock } from '../time/index.js';

export interface CacheOptions {
  /** Maximum number of entries before LRU eviction. */
  maxSize: number;
  /** Time-to-live in milliseconds; stale entries are treated as misses. */
  ttlMs: number;
}

export interface Cache<K extends string | number, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
  clear(): void;
  size(): number;
}

interface Entry<V> {
  value: V;
  expiresAtMs: number;
}

/** Create a deterministic LRU+TTL cache using an injected time source. */
export function createCache<K extends string | number, V extends NonNullable<unknown>>(
  options: CacheOptions,
  clock: Clock,
): Cache<K, V> {
  if (!Number.isSafeInteger(options.maxSize) || options.maxSize <= 0) {
    throw new RangeError('Cache maxSize must be a positive safe integer');
  }
  if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs <= 0) {
    throw new RangeError('Cache ttlMs must be a positive safe integer');
  }

  const entries = new Map<K, Entry<V>>();

  function purgeExpired(): void {
    const now = clock.nowMs();
    for (const [key, entry] of entries) {
      if (entry.expiresAtMs <= now) entries.delete(key);
    }
  }

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAtMs <= clock.nowMs()) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAtMs: clock.nowMs() + options.ttlMs });
      if (entries.size > options.maxSize) {
        const leastRecentlyUsed = entries.keys().next().value as K | undefined;
        if (leastRecentlyUsed !== undefined) entries.delete(leastRecentlyUsed);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    size() {
      purgeExpired();
      return entries.size;
    },
  };
}
