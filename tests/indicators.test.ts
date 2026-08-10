import { describe, expect, it } from 'vitest';
import { realizedVolatilityPct, rsi, sma } from '../packages/core/src/index.js';

describe('indicators', () => {
  it('averages the last N values and returns null when too short', () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1, 2, 3, 4], 4)).toBe(2.5);
    expect(sma([1, 2], 3)).toBeNull();
  });

  it('computes Wilder RSI and returns null when too short', () => {
    const rising = Array.from({ length: 30 }, (_, index) => 100 + index);
    const falling = Array.from({ length: 30 }, (_, index) => 100 - index);
    expect(rsi(rising, 14)).toBe(100);
    expect(rsi(falling, 14)).toBe(0);
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });

  it('computes realized volatility without guessing on short history', () => {
    expect(realizedVolatilityPct(Array(40).fill(100))).toBeCloseTo(0, 6);
    const choppy = Array.from({ length: 40 }, (_, index) => (index % 2 === 0 ? 100 : 110));
    expect(realizedVolatilityPct(choppy)).toBeGreaterThan(50);
    expect(realizedVolatilityPct([100, 101, 102], 30)).toBeNull();
  });
});
