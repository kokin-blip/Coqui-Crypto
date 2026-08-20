import { describe, expect, it } from 'vitest';

import {
  backtestDecisionDataset,
  buildDecisionMarketDataset,
  DEFAULT_TRADE_COST_CONFIG,
  instrumentKey,
  type MarketBar,
  type MomentumConfig,
  type VolTargetConfig,
} from '../packages/core/src/index.js';
import { evaluateTrendVolResearch } from '../packages/core/src/research/trendvol-evaluator.js';

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2024, 0, 1);
const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });
const momentum: MomentumConfig = {
  lookbackDays: 10,
  volatilityDays: 5,
  maxRelativeTilt: 0.35,
  defensiveScale: 0.2,
  targetVolatilityPct: 55,
};
const volTarget: VolTargetConfig = {
  targetVolPct: 40,
  volLookbackDays: 5,
  minExposure: 0.1,
  maxExposure: 1,
  trendGateDays: 10,
  belowTrendMaxExposure: 0.7,
};

function bars(assetId: typeof BTC, offset: number): MarketBar[] {
  return Array.from({ length: 90 }, (_, day) => {
    const close = 100 + offset + day * 0.4 + Math.sin((day + offset) / 4) * 3;
    return {
      assetId,
      source: 'fixture',
      interval: '1d',
      startTimeMs: START_MS + day * DAY_MS,
      endTimeMs: START_MS + (day + 1) * DAY_MS,
      open: close * 1.001,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1_000,
      isComplete: true,
      retrievedAtMs: START_MS + 91 * DAY_MS,
      quality: 'reported_ohlc',
    };
  });
}

describe('specialized trend-vol research evaluator', () => {
  it('matches the authoritative full engine for every retained track and cost', () => {
    const dataset = buildDecisionMarketDataset(
      { [BTC]: bars(BTC, 0), [ETH]: bars(ETH, 20) },
      [BTC, ETH],
      { policy: 'reject-on-gap', nowMs: START_MS + 92 * DAY_MS },
    );
    const targets = [{ assetId: BTC, weight: 0.5 }, { assetId: ETH, weight: 0.5 }];
    const options = {
      warmup: 20,
      rebalanceEveryDays: 7,
      momentum,
      volTarget,
      tradeCosts: DEFAULT_TRADE_COST_CONFIG,
      cashAprPct: 3,
    } as const;
    const full = backtestDecisionDataset(dataset, targets, {
      ...options,
      clock: { nowMs: () => START_MS + 92 * DAY_MS },
      evalSignal: () => null,
    });
    const specialized = evaluateTrendVolResearch(dataset, targets, options);

    expect(specialized).toEqual({
      hold: full.hold,
      passive: full.passive,
      trendvol: full.trendvol,
      executionModel: full.executionModel,
      datasetHash: full.datasetHash,
    });
  });
});
