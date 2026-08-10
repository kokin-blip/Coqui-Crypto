import { describe, expect, it } from 'vitest';
import {
  annotateCandidateBuyIntent,
  buildBuyCandidateOverlay,
  decimal,
  instrumentKey,
  scoreBuyCandidate,
  type AllocationPolicy,
  type AssetRef,
  type BuyCandidateMarket,
  type ExecutionIntent,
  type Holding,
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

function holding(id: string, quantity: number, priceUsd: number): Holding {
  return {
    asset: asset(id),
    quantity: decimal(String(quantity)),
    avgCostUsd: decimal(String(priceUsd)),
    priceUsd: decimal(String(priceUsd)),
    valueUsd: decimal(String(quantity * priceUsd)),
    unrealizedPnlUsd: decimal('0'),
    unrealizedPnlPct: 0,
  };
}

function entryCloses(): number[] {
  return Array.from(
    { length: 45 },
    (_, index) => 100 + index * 0.35 + (index % 2 === 0 ? 2 : -1.5),
  );
}

function candidate(overrides: Partial<BuyCandidateMarket> = {}): BuyCandidateMarket {
  const closes = entryCloses();
  return {
    asset: asset('LINK'),
    priceUsd: closes[closes.length - 1]!,
    volume24hUsd: 50_000_000,
    marketCapUsd: 8_000_000_000,
    rank: 20,
    change24hPct: 2,
    change7dPct: 5.3,
    closes,
    ...overrides,
  };
}

function policy(): AllocationPolicy {
  return {
    targets: [
      { instrument: asset('BTC').instrument, weight: 0.6 },
      { instrument: asset('ETH').instrument, weight: 0.4 },
    ],
    rebalanceBandPct: 5,
  };
}

describe('scoreBuyCandidate', () => {
  it('confirms an entry when trend, momentum, liquidity, RSI, and volatility agree', () => {
    const scored = scoreBuyCandidate(candidate(), new Set());
    expect(scored.action).toBe('BUY');
    expect(scored.reasonCode).toBe('BUY_CANDIDATE_SCORE_CONFIRMED');
    expect(scored.score).toBeGreaterThanOrEqual(70);
    expect(scored.checks).toMatchObject({
      trendConfirmed: true,
      momentumConfirmed: true,
      liquidityOk: true,
    });
  });

  it('holds below the liquidity floor and when the canonical instrument is already held', () => {
    const illiquid = scoreBuyCandidate(candidate({ volume24hUsd: 20_000 }), new Set());
    expect(illiquid.action).toBe('HOLD');
    expect(illiquid.reasonCode).toBe('HOLD_LIQUIDITY_BELOW_MINIMUM');

    const market = candidate();
    const held = new Set([instrumentKey(market.asset.instrument)]);
    const duplicate = scoreBuyCandidate(market, held);
    expect(duplicate.action).toBe('HOLD');
    expect(duplicate.reasonCode).toBe('HOLD_POSITION_ALREADY_HELD');
  });
});

describe('buildBuyCandidateOverlay', () => {
  it('adds a small candidate sleeve and scales existing targets', () => {
    const overlay = buildBuyCandidateOverlay(policy(), [holding('BTC', 1, 1000)], [candidate()]);

    expect(overlay.selected).toHaveLength(1);
    const weights = new Map(
      overlay.targets.map((target) => [instrumentKey(target.instrument), target.weight]),
    );
    expect(weights.get(instrumentKey(asset('LINK').instrument))).toBeCloseTo(0.08, 6);
    expect(weights.get(instrumentKey(asset('BTC').instrument))).toBeCloseTo(0.552, 6);
    expect(weights.get(instrumentKey(asset('ETH').instrument))).toBeCloseTo(0.368, 6);
    expect(overlay.candidateHoldings[0]?.asset.instrument.productId).toBe('LINK-USD');
    expect(overlay.candidateHoldings[0]?.quantity).toBe('0');
  });

  it('caps each candidate target by the sizing policy', () => {
    const overlay = buildBuyCandidateOverlay(policy(), [holding('BTC', 1, 1000)], [candidate()], {
      minScore: 70,
      minVolume24hUsd: 2_000_000,
      minMarketCapUsd: 50_000_000,
      maxRank: 250,
      minHistoryDays: 35,
      maxRsi: 74,
      maxDailyMovePct: 20,
      maxVolatilityPct: 160,
      sleevePct: 0.1,
      maxCandidates: 1,
      maxCandidateWeightPct: 0.04,
    });
    const weights = new Map(
      overlay.targets.map((target) => [instrumentKey(target.instrument), target.weight]),
    );
    expect(overlay.selected[0]?.targetWeight).toBeCloseTo(0.04, 6);
    expect(weights.get(instrumentKey(asset('LINK').instrument))).toBeCloseTo(0.04, 6);
    expect(weights.get(instrumentKey(asset('BTC').instrument))).toBeCloseTo(0.576, 6);
    expect(weights.get(instrumentKey(asset('ETH').instrument))).toBeCloseTo(0.384, 6);
  });
});

describe('annotateCandidateBuyIntent', () => {
  it('attaches a decimal reference price only to the matching canonical buy intent', () => {
    const market = candidate();
    const scored = { ...scoreBuyCandidate(market, new Set()), targetWeight: 0.08 };
    const intent: ExecutionIntent = {
      asset: market.asset,
      side: 'buy',
      amountUsd: decimal('120'),
      origin: 'rebalance',
      urgency: 'passive',
    };
    const annotated = annotateCandidateBuyIntent(intent, scored);
    expect(annotated.origin).toBe('rule');
    expect(annotated.urgency).toBe('standard');
    expect(annotated.referencePriceUsd).toBe(String(market.priceUsd));
    expect(annotated.reason).toContain('Target sleeve 8.0%');
  });
});
