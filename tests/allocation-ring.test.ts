import { describe, expect, it } from 'vitest';

import { allocationColor, allocationPercentages } from '../apps/desktop/src/renderer/app/allocation-data.js';

describe('allocation ring percentages', () => {
  it('derives percentages from exact decimal units without binary-float allocation drift', () => {
    expect(allocationPercentages([
      { id: 'btc', label: 'Bitcoin', valueUsd: '0.1' },
      { id: 'eth', label: 'Ethereum', valueUsd: '0.2' },
    ])).toEqual([
      { id: 'btc', label: 'Bitcoin', valueUsd: '0.1', value: 33.3333, percent: 33.3333 },
      { id: 'eth', label: 'Ethereum', valueUsd: '0.2', value: 66.6666, percent: 66.6666 },
    ]);
  });

  it('truncates excess precision and excludes zero, negative, and malformed values', () => {
    expect(allocationPercentages([
      { id: 'cash', label: 'Cash', valueUsd: '1.000000009' },
      { id: 'zero', label: 'Zero', valueUsd: '0' },
      { id: 'negative', label: 'Negative', valueUsd: '-1' },
      { id: 'invalid', label: 'Invalid', valueUsd: '1e3' },
    ])).toEqual([
      { id: 'cash', label: 'Cash', valueUsd: '1.000000009', value: 100, percent: 100 },
    ]);
  });

  it('returns an explicit empty allocation when no positive priced holdings exist', () => {
    expect(allocationPercentages([])).toEqual([]);
    expect(allocationPercentages([{ id: 'unknown', label: 'Unknown', valueUsd: 'n/a' }]))
      .toEqual([]);
  });
});

describe('allocation asset colors', () => {
  it('keeps asset colors stable across reorderings and symbol capitalization', () => {
    const data = [{ id: 'BTC', label: 'BTC', valueUsd: '4480' }, { id: 'USD', label: 'USD', valueUsd: '5520' }, { id: 'ETH', label: 'ETH', valueUsd: '800' }];
    const colors = (rows: typeof data) => Object.fromEntries(allocationPercentages(rows).map((entry) => [entry.id, allocationColor(entry.id)]));
    expect(colors([...data].reverse())).toEqual(colors(data));
    expect(allocationColor(' btc ')).toBe(allocationColor('BTC'));
    expect(allocationColor('BTC')).not.toBe(allocationColor('USD'));
  });
});
