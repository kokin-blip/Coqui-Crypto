import { describe, expect, it } from 'vitest';
import {
  computeAllocation,
  computeRebalancePlan,
  decimal,
  holdingsFromLots,
  instrumentKey,
  type AllocationPolicy,
  type AssetRef,
  type Holding,
  type TaxLot,
} from '../packages/core/src/index.js';

const NOW = 2_000_000_000_000;

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
const key = (id: string) => instrumentKey(asset(id).instrument);
function lot(id: string, assetId: string, qty: number, costUsd: number, remaining = qty): TaxLot {
  return { id, asset: asset(assetId), quantity: decimal(String(qty)), remaining: decimal(String(remaining)), costUsd: decimal(String(costUsd)), acquiredAt: NOW, source: 'manual', externalId: null };
}
function holding(id: string, quantity: number, avgCostUsd: number, priceUsd: number | null): Holding {
  const valueUsd = priceUsd !== null ? quantity * priceUsd : null;
  const cost = quantity * avgCostUsd;
  return {
    asset: asset(id),
    quantity: decimal(String(quantity)),
    avgCostUsd: decimal(String(avgCostUsd)),
    priceUsd: priceUsd === null ? null : decimal(String(priceUsd)),
    valueUsd: valueUsd === null ? null : decimal(String(valueUsd)),
    unrealizedPnlUsd: valueUsd !== null ? decimal(String(valueUsd - cost)) : null,
    unrealizedPnlPct: valueUsd !== null && cost > 0 ? ((valueUsd - cost) / cost) * 100 : null,
  };
}

describe('holdingsFromLots', () => {
  it('aggregates lots per asset with blended cost + live P&L', () => {
    const lots = [lot('a', 'BTC', 1, 10_000), lot('b', 'BTC', 1, 20_000)];
    const btc = holdingsFromLots(lots, { [key('BTC')]: decimal('40000') })[0]!;
    expect(btc.quantity).toBe('2');
    expect(btc.avgCostUsd).toBe('15000');
    expect(btc.valueUsd).toBe('80000');
    expect(btc.unrealizedPnlUsd).toBe('50000'); // 80k − 30k cost
    expect(btc.unrealizedPnlPct).toBeCloseTo(166.67, 1);
  });

  it('ignores fully-consumed lots and leaves unpriced assets null', () => {
    const lots = [lot('a', 'BTC', 1, 10_000, 0), lot('c', 'SOL', 10, 1_000)];
    const holdings = holdingsFromLots(lots, {});
    expect(holdings).toHaveLength(1); // BTC lot was fully consumed
    expect(holdings[0]!.asset.symbol).toBe('SOL');
    expect(holdings[0]!.valueUsd).toBeNull();
    expect(holdings[0]!.unrealizedPnlUsd).toBeNull();
  });

  it('sorts biggest position first, unpriced last', () => {
    const lots = [lot('a', 'BTC', 1, 1_000), lot('b', 'ETH', 1, 1_000), lot('c', 'SOL', 1, 1_000)];
    const holdings = holdingsFromLots(lots, { [key('BTC')]: decimal('100'), [key('ETH')]: decimal('500') }); // SOL unpriced
    expect(holdings.map((h) => h.asset.symbol)).toEqual(['ETH', 'BTC', 'SOL']);
  });
});

describe('computeAllocation', () => {
  it('computes actual weights and drift vs a policy', () => {
    const holdings = [holding('BTC', 1, 0, 60), holding('ETH', 1, 0, 40)]; // 60 / 40 = $100
    const policy: AllocationPolicy = {
      targets: [
        { instrument: asset('BTC').instrument, weight: 0.5 },
        { instrument: asset('ETH').instrument, weight: 0.5 },
      ],
      rebalanceBandPct: 5,
    };
    const alloc = computeAllocation(holdings, NOW, policy);
    expect(alloc.totalValueUsd).toBe('100');
    const btc = alloc.slices.find((s) => s.asset.symbol === 'BTC')!;
    expect(btc.actualWeight).toBeCloseTo(0.6);
    expect(btc.driftPct).toBeCloseTo(10); // 60% actual − 50% target = +10pp
    const eth = alloc.slices.find((s) => s.asset.symbol === 'ETH')!;
    expect(eth.driftPct).toBeCloseTo(-10);
  });

  it('leaves targets/drift null without a policy', () => {
    const alloc = computeAllocation([holding('BTC', 1, 0, 100)], NOW);
    expect(alloc.slices[0]!.targetWeight).toBeNull();
    expect(alloc.slices[0]!.driftPct).toBeNull();
  });

  it('reports null drift for an unpriced targeted holding (not a max underweight)', () => {
    // BTC price feed is momentarily out; ETH is priced. BTC must not read as −50pp.
    const holdings = [holding('BTC', 1, 0, null), holding('ETH', 1, 0, 40)];
    const policy: AllocationPolicy = {
      targets: [
        { instrument: asset('BTC').instrument, weight: 0.5 },
        { instrument: asset('ETH').instrument, weight: 0.5 },
      ],
      rebalanceBandPct: 5,
    };
    const alloc = computeAllocation(holdings, NOW, policy);
    const btc = alloc.slices.find((s) => s.asset.symbol === 'BTC')!;
    expect(btc.targetWeight).toBe(0.5);
    expect(btc.driftPct).toBeNull(); // unknown, not −50pp
  });
});

describe('computeRebalancePlan', () => {
  const policy: AllocationPolicy = {
    targets: [
      { instrument: asset('BTC').instrument, weight: 0.5 },
      { instrument: asset('ETH').instrument, weight: 0.5 },
    ],
    rebalanceBandPct: 5,
  };

  it('proposes a sell for the overweight + a buy for the underweight, estimate-only', () => {
    const holdings = [holding('BTC', 1, 0, 60), holding('ETH', 1, 0, 40)]; // $100 total
    const plan = computeRebalancePlan(holdings, policy, NOW);
    expect(plan.estimateOnly).toBe(true);
    expect(plan.maxDriftPct).toBeCloseTo(10);
    expect(plan.turnoverUsd).toBe('20'); // $10 each side

    const sell = plan.trades.find((t) => t.asset.symbol === 'BTC')!;
    expect(sell.side).toBe('sell');
    expect(sell.amountUsd).toBe('10'); // 50% of $100 = $50 target, hold $60
    expect(Number(sell.estimatedQty)).toBeCloseTo(10 / 60);
    expect(sell.reason).toContain('overweight');

    const buy = plan.trades.find((t) => t.asset.symbol === 'ETH')!;
    expect(buy.side).toBe('buy');
    expect(buy.reason).toContain('underweight');
  });

  it('emits no trades when every slice is within the band', () => {
    const holdings = [holding('BTC', 1, 0, 51), holding('ETH', 1, 0, 49)]; // 51/49, band 5pp
    const plan = computeRebalancePlan(holdings, policy, NOW);
    expect(plan.trades).toHaveLength(0);
    expect(plan.turnoverUsd).toBe('0');
  });

  it('ignores untargeted holdings and a zero-value book', () => {
    const withUntargeted = computeRebalancePlan([holding('DOGE', 1, 0, 100)], policy, NOW);
    expect(withUntargeted.trades).toHaveLength(0);
    const empty = computeRebalancePlan([holding('BTC', 1, 0, null)], policy, NOW);
    expect(empty.trades).toHaveLength(0);
  });

  it('emits no phantom trade for an unpriced holding in a priced book', () => {
    // BTC unpriced, ETH priced → BTC would otherwise look −50pp and get a buy
    // sized off $0 value with estimatedQty 0. It must simply be skipped.
    const plan = computeRebalancePlan([holding('BTC', 1, 0, null), holding('ETH', 1, 0, 40)], policy, NOW);
    expect(plan.trades.some((t) => t.asset.symbol === 'BTC')).toBe(false);
  });
});
