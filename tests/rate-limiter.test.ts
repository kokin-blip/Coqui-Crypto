import { afterEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  createRateLimiter,
  createRateLimiterRegistry,
  DEFAULT_HTTP_RATE_LIMITS,
  type RateLimitClock,
} from '../packages/adapters/src/index.js';

afterEach(() => vi.useRealTimers());

describe('createRateLimiter', () => {
  it('grants tokens immediately and queues overflow in FIFO order', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ requests: 2, windowMs: 1_000 });
    await limiter.acquire();
    await limiter.acquire();
    const order: number[] = [];
    const third = limiter.acquire().then(() => order.push(3));
    const fourth = limiter.acquire().then(() => order.push(4));
    expect(limiter.available()).toBe(0);
    expect(limiter.pending()).toBe(2);
    await vi.advanceTimersByTimeAsync(1_001);
    await Promise.all([third, fourth]);
    expect(order).toEqual([3, 4]);
    limiter.destroy();
  });

  it('releases queued shutdown waiters and validates limits', async () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ requests: 1, windowMs: 10_000 });
    await limiter.acquire();
    const waiting = limiter.acquire();
    limiter.destroy();
    await expect(waiting).resolves.toBe('destroyed');
    expect(() => createRateLimiter({ requests: 0, windowMs: 1 })).toThrow(RangeError);
    expect(() => createRateLimiter({ requests: 1, windowMs: 0 })).toThrow(RangeError);
  });

  it('returns aborted without consuming capacity and destroyed after shutdown', async () => {
    const limiter = createRateLimiter({ requests: 1, windowMs: 10_000 });
    const aborted = new AbortController();
    aborted.abort();
    await expect(limiter.acquire(aborted.signal)).resolves.toBe('aborted');
    await expect(limiter.acquire()).resolves.toBe('acquired');
    limiter.destroy();
    await expect(limiter.acquire()).resolves.toBe('destroyed');
  });

  it('matches the deterministic GCRA admission schedule across generated quotas', async () => {
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 1, max: 10 }),
      fc.integer({ min: 10, max: 10_000 }),
      fc.integer({ min: 1, max: 50 }),
      async (requests, windowMs, count) => {
        let nowMs = 0;
        const clock: RateLimitClock = {
          nowMs: () => nowMs,
          sleep: async (milliseconds, signal) => {
            if (signal.aborted) return 'aborted';
            nowMs += milliseconds;
            return 'elapsed';
          },
        };
        const limiter = createRateLimiter({ requests, windowMs, clock });
        const admittedAt: number[] = [];
        for (let index = 0; index < count; index += 1) {
          expect(await limiter.acquire()).toBe('acquired');
          admittedAt.push(nowMs);
        }
        const intervalMs = windowMs / requests;
        for (let index = 0; index < admittedAt.length; index += 1) {
          const expected = index < requests ? 0 : (index - requests + 1) * intervalMs;
          expect(admittedAt[index]).toBeCloseTo(expected, 8);
        }
        limiter.destroy();
      },
    ), { seed: 2_026_080_9, numRuns: 100 });
  });
});

describe('createRateLimiterRegistry', () => {
  it('uses conservative Coinbase limits and one instance per normalized host', () => {
    expect(DEFAULT_HTTP_RATE_LIMITS['api.coinbase.com']).toEqual({
      requests: 2,
      windowMs: 1_000,
    });
    expect(DEFAULT_HTTP_RATE_LIMITS['api.coingecko.com']).toEqual({
      requests: 30,
      windowMs: 60_000,
    });
    const registry = createRateLimiterRegistry();
    expect(registry.forDomain('API.COINBASE.COM')).toBe(
      registry.forDomain('api.coinbase.com'),
    );
    expect(registry.forDomain('api.coinbase.com')).not.toBe(
      registry.forDomain('api.exchange.coinbase.com'),
    );
    registry.destroyAll();
  });

  it('supports narrower host-specific overrides', () => {
    const registry = createRateLimiterRegistry({
      'api.coinbase.com': { requests: 1, windowMs: 2_000 },
    });
    expect(registry.forDomain('api.coinbase.com').available()).toBe(1);
    registry.destroyAll();
  });
});
