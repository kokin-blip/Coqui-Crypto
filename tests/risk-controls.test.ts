import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RISK_CONTROL_PROFILE,
  expectedShortfallPct,
  marketQualityFromCosts,
  resolveRiskControlState,
  simulateExecutionPolicy,
  decimal,
  DEFAULT_TRADE_COST_CONFIG,
  type AssetRef,
  type ExecutionIntent,
} from '../packages/core/src/index.js';

function asset(id: string): AssetRef {
  return {
    instrument: { venue: 'coinbase', productId: `${id}-USD`, productType: 'spot' },
    symbol: id,
    name: id,
    baseAsset: id,
    quoteAsset: 'USD',
    coingeckoId: id.toLowerCase(),
  };
}

function intent(amountUsd: number): ExecutionIntent {
  return {
    asset: asset('BTC'),
    side: 'buy',
    amountUsd: decimal(String(amountUsd)),
    origin: 'rebalance',
    urgency: 'passive',
  };
}

describe('natural-market risk controls', () => {
  it('moves through staged drawdown de-risking and hard stop', () => {
    const normal = resolveRiskControlState({ equityValues: [100, 101, 102] });
    const caution = resolveRiskControlState({ equityValues: [100, 103, 100] });
    const defense = resolveRiskControlState({ equityValues: [100, 106, 100] });
    const hard = resolveRiskControlState({ equityValues: [100, 110, 100] });

    expect(normal.stage).toBe('normal');
    expect(caution.stage).toBe('caution');
    expect(caution.exposureScale).toBe(0.5);
    expect(defense.stage).toBe('defense');
    expect(defense.exposureScale).toBe(0.25);
    expect(hard.stage).toBe('hard_stop');
    expect(hard.blockReason).toContain('drawdown');
  });

  it('raises expected shortfall on heavy-tail fixtures', () => {
    const calm = expectedShortfallPct([100, 101, 102, 103, 104, 105]);
    const tail = expectedShortfallPct([100, 101, 102, 80, 81, 82]);

    expect(tail).toBeGreaterThan(calm);
    expect(tail).toBeGreaterThan(10);
  });

  it('blocks execution when stale or execution shortfall breaches the configured limit', () => {
    const staleQuality = marketQualityFromCosts({
      asOf: 1_700_000_000_000,
      feedAgeMs: DEFAULT_RISK_CONTROL_PROFILE.staleDataTimeoutMs + 1,
      spreadBps: 10,
      slippageBps: 15,
    });
    const stale = simulateExecutionPolicy(intent(100), DEFAULT_TRADE_COST_CONFIG, staleQuality);
    expect(stale.blocked).toBe(true);
    expect(stale.reason).toContain('stale');

    const thinQuality = marketQualityFromCosts({
      asOf: 1_700_000_000_000,
      spreadBps: 800,
      slippageBps: 800,
      impactBps: 200,
    });
    const thin = simulateExecutionPolicy(intent(10_000), DEFAULT_TRADE_COST_CONFIG, thinQuality);
    expect(thin.blocked).toBe(true);
    expect(thin.reason).toContain('execution shortfall');
  });
});
