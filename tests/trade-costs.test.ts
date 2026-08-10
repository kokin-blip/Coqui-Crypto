import { describe, expect, it } from 'vitest';
import {
  estimatePlanCosts,
  estimateTradeCost,
  estimateTurnoverCostUsd,
  totalTradeCostBps,
  DEFAULT_TRADE_COST_CONFIG,
  GUARD_TRADE_COST_CONFIG,
} from '../packages/core/src/costs/index.js';

describe('estimateTradeCost', () => {
  it('estimates fee, spread, and slippage from basis-point settings', () => {
    const estimate = estimateTradeCost(
      { assetId: 'BTC', symbol: 'BTC', side: 'buy', amountUsd: 1000 },
      { feeBps: 50, spreadBps: 10, slippageBps: 5, minUsefulTradeUsd: 25 },
    );

    expect(estimate.feeUsd).toBeCloseTo(5, 6);
    expect(estimate.spreadUsd).toBeCloseTo(1, 6);
    expect(estimate.slippageUsd).toBeCloseTo(0.5, 6);
    expect(estimate.totalCostUsd).toBeCloseTo(6.5, 6);
    expect(estimate.totalCostPct).toBeCloseTo(0.65, 6);
    expect(estimate.warning).toBeNull();
  });

  it('flags trades below the useful-trade floor', () => {
    const estimate = estimateTradeCost(
      { assetId: 'ETH', symbol: 'ETH', side: 'sell', amountUsd: 10 },
      { feeBps: 50, spreadBps: 10, slippageBps: 5, minUsefulTradeUsd: 25 },
    );

    expect(estimate.warning).toContain('ETH');
    expect(estimate.warning).toContain('$25');
  });
});

describe('size-aware market impact', () => {
  const trade = (amountUsd: number) => ({ assetId: 'BTC', symbol: 'BTC', side: 'buy' as const, amountUsd });

  it('is off in the default (backtest) cost model — cost% is flat across sizes', () => {
    const small = estimateTradeCost(trade(100), DEFAULT_TRADE_COST_CONFIG).totalCostPct;
    const large = estimateTradeCost(trade(500_000), DEFAULT_TRADE_COST_CONFIG).totalCostPct;
    expect(large).toBeCloseTo(small, 9); // no size dependence → frozen evidence unchanged
    expect(small).toBeCloseTo(0.85, 6); // 60+10+15 bps
  });

  it('rises with size under the guard cost model', () => {
    const small = estimateTradeCost(trade(1000), GUARD_TRADE_COST_CONFIG).totalCostPct;
    const large = estimateTradeCost(trade(400_000), GUARD_TRADE_COST_CONFIG).totalCostPct;
    expect(large).toBeGreaterThan(small);
    // $400k = 16× the $25k ref → √16 = 4 → 60×4 = 240bps impact on top of 85bps.
    expect(large).toBeCloseTo(3.25, 6);
  });
});

describe('estimatePlanCosts', () => {
  it('sums costs and turnover across a plan', () => {
    const estimate = estimatePlanCosts(
      [
        { assetId: 'BTC', symbol: 'BTC', side: 'sell', amountUsd: 400 },
        { assetId: 'ETH', symbol: 'ETH', side: 'buy', amountUsd: 600 },
      ],
      { feeBps: 50, spreadBps: 10, slippageBps: 5, minUsefulTradeUsd: 25 },
    );

    expect(estimate.turnoverUsd).toBe(1000);
    expect(estimate.totalCostUsd).toBeCloseTo(6.5, 6);
    expect(estimate.costPctOfTurnover).toBeCloseTo(0.65, 6);
    expect(estimate.trades).toHaveLength(2);
    expect(estimate.warnings).toEqual([]);
  });

  it('handles empty plans without dividing by zero', () => {
    const estimate = estimatePlanCosts([]);

    expect(estimate.turnoverUsd).toBe(0);
    expect(estimate.totalCostUsd).toBe(0);
    expect(estimate.costPctOfTurnover).toBe(0);
    expect(estimate.warnings).toEqual([]);
  });
});

describe('turnover cost helpers', () => {
  it('estimates cost from turnover without per-asset trade rows', () => {
    const config = { feeBps: 50, spreadBps: 10, slippageBps: 5, minUsefulTradeUsd: 25 };

    expect(totalTradeCostBps(config)).toBe(65);
    expect(estimateTurnoverCostUsd(2000, config)).toBeCloseTo(13, 6);
  });
});
