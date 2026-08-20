import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';

export type RateLimitAcquireOutcome = 'acquired' | 'aborted' | 'destroyed';

export interface RateLimitClock {
  /** Monotonic milliseconds used only for elapsed-time decisions. */
  nowMs(): number;
  /** Sleep until the delay elapses or the supplied signal aborts. */
  sleep(milliseconds: number, signal: AbortSignal): Promise<'elapsed' | 'aborted'>;
}

export interface RateLimiter {
  /** Acquire one request cell in FIFO order. */
  acquire(signal?: AbortSignal): Promise<RateLimitAcquireOutcome>;
  available(): number;
  pending(): number;
  /** Stop admissions and resolve every waiter explicitly as destroyed. */
  destroy(): void;
}

export interface RateLimiterOptions {
  requests: number;
  windowMs: number;
  /** Injectable monotonic clock for deterministic traces. */
  clock?: RateLimitClock;
}

const systemRateLimitClock: RateLimitClock = {
  nowMs: () => performance.now(),
  sleep: async (milliseconds, signal) => await new Promise((resolve) => {
    if (signal.aborted) {
      resolve('aborted');
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve('elapsed');
    }, Math.max(0, milliseconds));
    timer.unref();
    const abort = () => {
      clearTimeout(timer);
      resolve('aborted');
    };
    signal.addEventListener('abort', abort, { once: true });
  }),
};

interface Waiter {
  readonly resolve: (outcome: RateLimitAcquireOutcome) => void;
  readonly signal?: AbortSignal;
  abort?: () => void;
  settled: boolean;
}

/**
 * Create a FIFO Generic Cell Rate Algorithm limiter. The configured request
 * count is the initial burst capacity; replenishment is evenly spaced across
 * the window, so a fixed-window boundary cannot admit a double burst.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  if (!Number.isSafeInteger(options.requests) || options.requests <= 0) {
    throw new RangeError('Rate-limit requests must be a positive safe integer');
  }
  if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
    throw new RangeError('Rate-limit windowMs must be a positive safe integer');
  }

  const clock = options.clock ?? systemRateLimitClock;
  const intervalMs = options.windowMs / options.requests;
  const burstToleranceMs = intervalMs * (options.requests - 1);
  let theoreticalArrivalMs = clock.nowMs();
  let destroyed = false;
  let draining = false;
  let wake = new AbortController();
  const queue: Waiter[] = [];

  const interruptDrain = (): void => {
    wake.abort();
    wake = new AbortController();
  };

  const settle = (waiter: Waiter, outcome: RateLimitAcquireOutcome): void => {
    if (waiter.settled) return;
    waiter.settled = true;
    if (waiter.signal && waiter.abort) waiter.signal.removeEventListener('abort', waiter.abort);
    waiter.resolve(outcome);
  };

  const nextLiveWaiter = (): Waiter | undefined => {
    while (queue[0]?.settled) queue.shift();
    return queue[0];
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (!destroyed) {
        const waiter = nextLiveWaiter();
        if (!waiter) return;
        const nowMs = clock.nowMs();
        const earliestMs = theoreticalArrivalMs - burstToleranceMs;
        if (nowMs >= earliestMs) {
          queue.shift();
          theoreticalArrivalMs = Math.max(nowMs, theoreticalArrivalMs) + intervalMs;
          settle(waiter, 'acquired');
          continue;
        }
        await clock.sleep(Math.max(0, earliestMs - nowMs), wake.signal);
      }
    } finally {
      draining = false;
      if (!destroyed && nextLiveWaiter()) void drain();
    }
  };

  return {
    acquire(signal) {
      if (destroyed) return Promise.resolve('destroyed');
      if (signal?.aborted) return Promise.resolve('aborted');
      return new Promise<RateLimitAcquireOutcome>((resolve) => {
        const waiter: Waiter = signal
          ? { resolve, signal, settled: false }
          : { resolve, settled: false };
        if (signal) {
          waiter.abort = () => {
            settle(waiter, 'aborted');
            interruptDrain();
            void drain();
          };
          signal.addEventListener('abort', waiter.abort, { once: true });
        }
        queue.push(waiter);
        void drain();
      });
    },
    available() {
      if (destroyed) return 0;
      const nowMs = clock.nowMs();
      let simulatedArrival = theoreticalArrivalMs;
      let available = 0;
      while (
        available < options.requests &&
        nowMs >= simulatedArrival - burstToleranceMs
      ) {
        available += 1;
        simulatedArrival = Math.max(nowMs, simulatedArrival) + intervalMs;
      }
      return available;
    },
    pending() {
      return queue.filter((waiter) => !waiter.settled).length;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      interruptDrain();
      for (const waiter of queue.splice(0)) settle(waiter, 'destroyed');
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
