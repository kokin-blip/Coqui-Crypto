import { describe, expect, it } from 'vitest';

import { bollinger, ema, macd, rsi, sma } from '../apps/desktop/src/renderer/app/chart-indicators.js';

const points = (values: readonly number[]) => values.map((close, index) => ({ day: `2026-01-${String(index + 1).padStart(2, '0')}`, close }));

describe('display-only market indicators', () => {
  it('uses exact complete windows and never emits partial SMA or Bollinger values', () => {
    expect(sma(points([1, 2, 3, 4]), 3)).toEqual([
      { day: '2026-01-03', value: 2 },
      { day: '2026-01-04', value: 3 },
    ]);
    expect(sma(points([1, 2]), 3)).toEqual([]);
    expect(bollinger(points([2, 2, 2]), 3, 2)).toEqual([
      { day: '2026-01-03', value: 2, upper: 2, lower: 2 },
    ]);
  });

  it('seeds EMA from the first complete arithmetic window', () => {
    expect(ema(points([1, 2, 3, 4]), 3)).toEqual([
      { day: '2026-01-03', value: 2 },
      { day: '2026-01-04', value: 3 },
    ]);
  });

  it('handles flat RSI deterministically and requires full MACD history', () => {
    expect(rsi(points(Array.from({ length: 15 }, () => 10)), 14)).toEqual([
      { day: '2026-01-15', value: 100 },
    ]);
    expect(macd(points(Array.from({ length: 33 }, (_, index) => index + 1)))).toEqual([]);
    expect(macd(points(Array.from({ length: 34 }, (_, index) => index + 1)))).toHaveLength(1);
  });

  it('treats missing calendar dates as missing rather than synthesizing observations', () => {
    expect(sma([{ day: '2026-01-01', close: 1 }, { day: '2026-01-03', close: 3 }], 2))
      .toEqual([{ day: '2026-01-03', value: 2 }]);
  });
});
