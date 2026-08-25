import { describe, expect, it } from 'vitest';

import {
  calculatePaperPerformance,
  calculateStartingPortfolioHoldBenchmark,
  deriveFifoPaperLots,
} from '../packages/core/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const HASH = 'a'.repeat(64);

function point(day: number, equityUsd: string | null, extra: Record<string, unknown> = {}) {
  return {
    dayUtc: T0 + day * DAY,
    equityUsd,
    benchmarkUsd: equityUsd,
    evidenceHash: HASH,
    unpricedCount: equityUsd === null ? 1 : 0,
    ...extra,
  };
}

describe('exact paper performance metrics', () => {
  it('handles flat and short histories without invented ratios', () => {
    const one = calculatePaperPerformance({ valuations: [point(0, '1000')] });
    expect(one.metrics).toMatchObject({
      annualizedReturnPct: null,
      volatilityPct: null,
      sharpe: null,
      sortino: null,
      calmar: null,
      maxDrawdownPct: '0',
      riskFreeRatePct: '0',
      annualizationDays: 365,
    });

    const flat = calculatePaperPerformance({
      valuations: [point(0, '1000'), point(1, '1000'), point(2, '1000')],
    });
    expect(flat.metrics.volatilityPct).toBe('0');
    expect(flat.metrics.sharpe).toBeNull();
    expect(flat.metrics.timeBelowHighPct).toBe('0');
  });

  it('does not fabricate missing or incomplete days and exposes both exclusions', () => {
    const result = calculatePaperPerformance({
      valuations: [point(0, '1000'), point(2, null), point(4, '1100')],
      unattributedOpeningBalance: true,
    });
    expect(result.points.map((entry) => entry.dayUtc)).toEqual([T0, T0 + 4 * DAY]);
    expect(result.exclusions).toEqual({
      incompleteValuationDays: 1,
      missingCalendarDays: 2,
      unattributedOpeningBalanceExcluded: true,
    });
  });

  it('removes external cash flow from return and P&L', () => {
    const result = calculatePaperPerformance({
      valuations: [
        point(0, '1000'),
        point(1, '1510', { cashFlowUsd: '500' }),
      ],
    });
    expect(result.points[1]).toMatchObject({ pnlUsd: '10', returnPct: '1' });
  });

  it('finds a recovered drawdown episode with exact dates', () => {
    const result = calculatePaperPerformance({
      valuations: [point(0, '100'), point(1, '80'), point(2, '90'), point(3, '101')],
    });
    expect(result.metrics.maxDrawdownPct).toBe('-20');
    expect(result.worstDrawdowns[0]).toEqual({
      peakDayUtc: T0,
      troughDayUtc: T0 + DAY,
      recoveredDayUtc: T0 + 3 * DAY,
      drawdownPct: '-20',
      declineDays: 1,
      recoveryDays: 2,
    });
  });

  it('reports an infinite no-loss profit factor and exact cost totals', () => {
    const result = calculatePaperPerformance({
      valuations: [point(0, '1000'), point(1, '1010')],
      closedLots: [{ closedAt: T0 + DAY, pnlUsd: '10.005' }],
      costs: [{
        notionalUsd: '250.10', venueFeeUsd: '1.005', spreadUsd: '0.20',
        slippageUsd: '0.30', impactUsd: '0.40',
      }],
    });
    expect(result.metrics.winRatePct).toBe('100');
    expect(result.metrics.profitFactor).toBe('infinite');
    expect(result.metrics).toMatchObject({
      venueFeesUsd: '1.005', spreadUsd: '0.2', slippageUsd: '0.3', impactUsd: '0.4',
    });
  });

  it('derives closed paper lots FIFO and excludes unattributed opening inventory', () => {
    const base = { spreadUsd: '0', slippageUsd: '0', impactUsd: '0' };
    const result = deriveFifoPaperLots([
      { ...base, productId: 'BTC-USD', side: 'buy', quantity: '2', notionalUsd: '200', venueFeeUsd: '2', filledAt: T0 },
      { ...base, productId: 'BTC-USD', side: 'buy', quantity: '1', notionalUsd: '150', venueFeeUsd: '1', filledAt: T0 + 1 },
      { ...base, productId: 'BTC-USD', side: 'sell', quantity: '2.5', notionalUsd: '400', venueFeeUsd: '4', filledAt: T0 + 2 },
      { ...base, productId: 'ETH-USD', side: 'sell', quantity: '1', notionalUsd: '10', venueFeeUsd: '0', filledAt: T0 + 3 },
    ]);
    expect(result.closedLots).toEqual([{ closedAt: T0 + 2, pnlUsd: '118.5' }]);
    expect(result.unattributedOpeningBalanceExcluded).toBe(true);
  });

  it('values immutable starting quantities at current exact-decimal prices', () => {
    expect(calculateStartingPortfolioHoldBenchmark({
      startingCashUsd: '100',
      startingPositions: [{ productId: 'BTC-USD', quantity: '2', valueUsd: '200' }],
      currentPositions: [{ productId: 'BTC-USD', quantity: '0.5', valueUsd: '75' }],
    })).toBe('400');
    expect(calculateStartingPortfolioHoldBenchmark({
      startingCashUsd: '100',
      startingPositions: [{ productId: 'BTC-USD', quantity: '2', valueUsd: '200' }],
      currentPositions: [{ productId: 'BTC-USD', quantity: '0.5', valueUsd: null }],
    })).toBeNull();
  });
});
