import { describe, expect, it } from 'vitest';

import { filterPointsByRange, rangeLookbackDays } from '../apps/desktop/src/renderer/app/chart-range.js';

describe('chart ranges', () => {
  it('maps saved ranges to bounded lookback windows', () => {
    expect(rangeLookbackDays('1d')).toBe(1);
    expect(rangeLookbackDays('1w')).toBe(7);
    expect(rangeLookbackDays('1m')).toBe(31);
    expect(rangeLookbackDays('3m')).toBe(93);
    expect(rangeLookbackDays('1y')).toBe(365);
    expect(rangeLookbackDays('all', 730)).toBe(730);
  });

  it('filters from the latest observation without inventing missing dates', () => {
    const points = [
      { day: '2026-01-01', value: '1' },
      { day: '2026-01-05', value: '2' },
      { day: '2026-01-07', value: '3' },
      { day: '2026-01-08', value: '4' },
    ];

    expect(filterPointsByRange(points, '1w')).toEqual(points.slice(1));
    expect(filterPointsByRange(points, '1d')).toEqual(points.slice(3));
    expect(filterPointsByRange(points, 'all')).toBe(points);
  });
});
