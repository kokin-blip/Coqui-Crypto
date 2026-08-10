import { describe, expect, it } from 'vitest';
import {
  dayKey,
  decimal,
  summarizePerformance,
  type PortfolioSnapshot,
} from '../packages/core/src/index.js';

const DAY = 86_400_000;

function snapshot(
  at: number,
  valueUsd: string,
  costUsd: string,
  realizedPnlUsd = '0',
): PortfolioSnapshot {
  return {
    at,
    valueUsd: decimal(valueUsd),
    costUsd: decimal(costUsd),
    realizedPnlUsd: decimal(realizedPnlUsd),
  };
}

describe('summarizePerformance', () => {
  it('degrades cleanly for an empty or single-point series', () => {
    const empty = summarizePerformance([]);
    expect(empty).toMatchObject({ since: null, latestValueUsd: null, timeWeightedReturnPct: null });
    expect(empty.series).toEqual([]);

    const single = summarizePerformance([snapshot(DAY, '1000.10', '800.05')]);
    expect(single).toMatchObject({
      since: DAY,
      latestValueUsd: '1000.10',
      periodChangeUsd: '0',
      totalPnlUsd: '200.05',
      timeWeightedReturnPct: null,
    });
  });

  it('sorts observations and computes exact changes and flows', () => {
    const summary = summarizePerformance([
      snapshot(2 * DAY, '1600.25', '1300.10'),
      snapshot(DAY, '1000.10', '800.05'),
    ]);
    expect(summary.series.map((point) => point.at)).toEqual([DAY, 2 * DAY]);
    expect(summary.periodChangeUsd).toBe('600.15');
    expect(summary.netFlowUsd).toBe('500.05');
    expect(summary.growthUsd).toBe('100.1');
  });

  it('strips contributions from time-weighted return', () => {
    const summary = summarizePerformance([
      snapshot(DAY, '1000', '1000'),
      snapshot(2 * DAY, '2000', '2000'),
      snapshot(3 * DAY, '2200', '2000'),
    ]);
    expect(summary.timeWeightedReturnPct).toBeCloseTo(10, 6);
  });

  it('tracks max drawdown and best and worst observed steps', () => {
    const summary = summarizePerformance([
      snapshot(DAY, '1000', '1000'),
      snapshot(2 * DAY, '1200', '1000'),
      snapshot(3 * DAY, '900', '1000'),
    ]);
    expect(summary.bestDayPct).toBeCloseTo(20, 6);
    expect(summary.worstDayPct).toBeCloseTo(-25, 6);
    expect(summary.maxDrawdownPct).toBeCloseTo(-25, 6);
  });
});

describe('dayKey', () => {
  it('normalizes any moment to UTC day start', () => {
    const noon = Date.UTC(2026, 5, 30, 12, 34, 56);
    expect(dayKey(noon)).toBe(Date.UTC(2026, 5, 30));
  });
});
