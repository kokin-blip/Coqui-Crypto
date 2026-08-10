import { describe, expect, it } from 'vitest';
import { createCache, FixedClock } from '../packages/core/src/index.js';

describe('createCache', () => {
  it('sets, gets, deletes, clears, and reports size', () => {
    const cache = createCache<string, number>(
      { maxSize: 10, ttlMs: 60_000 },
      new FixedClock(0),
    );
    expect(cache.get('missing')).toBeUndefined();
    cache.set('a', 42);
    cache.set('b', 7);
    expect(cache.get('a')).toBe(42);
    expect(cache.size()).toBe(2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('expires entries deterministically from the injected clock', () => {
    const clock = new FixedClock(1_000);
    const cache = createCache<string, number>({ maxSize: 10, ttlMs: 20 }, clock);
    cache.set('a', 99);
    clock.advanceBy(19);
    expect(cache.get('a')).toBe(99);
    clock.advanceBy(1);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('evicts the least-recently-used entry when maxSize is exceeded', () => {
    const cache = createCache<string, number>(
      { maxSize: 2, ttlMs: 60_000 },
      new FixedClock(0),
    );
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('b')).toBeUndefined();
  });

  it('rejects invalid limits', () => {
    expect(() => createCache({ maxSize: 0, ttlMs: 1 }, new FixedClock(0))).toThrow(RangeError);
    expect(() => createCache({ maxSize: 1, ttlMs: 0 }, new FixedClock(0))).toThrow(RangeError);
  });
});
