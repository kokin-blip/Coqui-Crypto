import { clearInterval, setInterval } from 'node:timers';

export interface RateLimiter {
  /** Acquire one request token, waiting for the next window when exhausted. */
  acquire(): Promise<void>;
  available(): number;
  pending(): number;
  /** Stop refills and release shutdown waiters. */
  destroy(): void;
}

export interface RateLimiterOptions {
  requests: number;
  windowMs: number;
}

/** Create a fixed-window FIFO limiter for one remote host. */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  if (!Number.isSafeInteger(options.requests) || options.requests <= 0) {
    throw new RangeError('Rate-limit requests must be a positive safe integer');
  }
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
    throw new RangeError('Rate-limit windowMs must be a positive safe integer');
  }

  let tokens = options.requests;
  let destroyed = false;
  const queue: Array<() => void> = [];
  const interval = setInterval(() => {
    tokens = options.requests;
    while (queue.length > 0 && tokens > 0) {
      tokens -= 1;
      queue.shift()?.();
    }
  }, options.windowMs);
  interval.unref();

  return {
    acquire() {
      if (destroyed) return Promise.resolve();
      if (tokens > 0) {
        tokens -= 1;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => queue.push(resolve));
    },
    available() {
      return tokens;
    },
    pending() {
      return queue.length;
    },
    destroy() {
      destroyed = true;
      clearInterval(interval);
      while (queue.length > 0) queue.shift()?.();
    },
  };
}

export interface RateLimiterRegistry {
  forDomain(hostname: string): RateLimiter;
  destroyAll(): void;
}

/**
 * Conservative limits checked against provider docs on 2026-08-02. Runtime
 * 429 responses and Retry-After remain authoritative when a plan differs.
 */
export const DEFAULT_HTTP_RATE_LIMITS: Readonly<Record<string, RateLimiterOptions>> = {
  'api.coinbase.com': { requests: 2, windowMs: 1_000 },
  'api.exchange.coinbase.com': { requests: 8, windowMs: 1_000 },
  'api.coingecko.com': { requests: 30, windowMs: 60_000 },
  'pro-api.coinmarketcap.com': { requests: 30, windowMs: 60_000 },
  'api.coinpaprika.com': { requests: 20, windowMs: 60_000 },
};

const FALLBACK_LIMIT: RateLimiterOptions = { requests: 60, windowMs: 60_000 };

/** Build one lazily-created limiter per hostname. */
export function createRateLimiterRegistry(
  overrides: Readonly<Record<string, RateLimiterOptions>> = {},
): RateLimiterRegistry {
  const limits = { ...DEFAULT_HTTP_RATE_LIMITS, ...overrides };
  const registry = new Map<string, RateLimiter>();
  return {
    forDomain(hostname) {
      const normalized = hostname.toLowerCase();
      const existing = registry.get(normalized);
      if (existing) return existing;
      const limiter = createRateLimiter(limits[normalized] ?? FALLBACK_LIMIT);
      registry.set(normalized, limiter);
      return limiter;
    },
    destroyAll() {
      for (const limiter of registry.values()) limiter.destroy();
      registry.clear();
    },
  };
}
