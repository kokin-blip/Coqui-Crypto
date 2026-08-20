import { describe, expect, it } from 'vitest';

import {
  FixedClock,
  decimal,
  instrumentKey,
  nonNegativeDecimal,
  type AssetRef,
  type InstrumentIdentity,
  type PriceSource,
  type SpotPriceObservation,
  type SpotPriceQuality,
  type TaxLot,
} from '@coqui/core';
import { PortfolioReadModelService } from '@coqui/services';
import {
  insertTaxLots,
  openDatabase,
  saveAllocationPolicy,
} from '@coqui/storage';

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};

const WBTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'WBTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'Wrapped Bitcoin',
  baseAsset: 'WBTC',
  quoteAsset: 'USD',
  coingeckoId: 'wrapped-bitcoin',
};

const ETH: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
  symbol: 'ETH',
  name: 'Ethereum',
  baseAsset: 'ETH',
  quoteAsset: 'USD',
  coingeckoId: 'ethereum',
};

function lot(id: string, asset: AssetRef, quantity: string, costUsd: string): TaxLot {
  return {
    id,
    asset,
    quantity: nonNegativeDecimal(quantity),
    remaining: nonNegativeDecimal(quantity),
    costUsd: nonNegativeDecimal(costUsd),
    acquiredAt: 100,
    source: 'manual',
    externalId: null,
  };
}

class FakePriceSource implements PriceSource {
  readonly name: string;
  readonly requests: InstrumentIdentity[][] = [];
  readonly #load: (
    instruments: readonly InstrumentIdentity[],
  ) => Promise<ReadonlyMap<string, SpotPriceObservation>>;

  constructor(
    load: (
      instruments: readonly InstrumentIdentity[],
    ) => Promise<ReadonlyMap<string, SpotPriceObservation>>,
    name = 'deterministic-prices',
  ) {
    this.name = name;
    this.#load = load;
  }

  async spot(
    instruments: readonly InstrumentIdentity[],
  ): Promise<ReadonlyMap<string, SpotPriceObservation>> {
    this.requests.push(instruments.map((instrument) => ({ ...instrument })));
    return this.#load(instruments);
  }
}

function observedPrice(
  priceUsd: string,
  source = 'coinbase',
  quality: SpotPriceQuality = 'venue_reported_last',
  observedAtMs: number | null = null,
): SpotPriceObservation {
  return { priceUsd: nonNegativeDecimal(priceUsd), source, quality, observedAtMs };
}

describe('portfolio read models', () => {
  it('uses injected pricing and time for an exact, immutable valuation', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(1_000);
    insertTaxLots([
      lot('btc-1', BTC, '1', '50'),
      lot('btc-2', BTC, '1', '50'),
      lot('wbtc-1', WBTC, '1', '50'),
    ], database);
    const source = new FakePriceSource(async () => {
      clock.advanceBy(25);
      return new Map([
        [instrumentKey(BTC.instrument), observedPrice('75', 'coinbase', 'venue_reported_last', 900)],
        [instrumentKey(WBTC.instrument), observedPrice('25')],
      ]);
    });
    const service = new PortfolioReadModelService({ database, clock, priceSource: source });

    const view = await service.portfolioView();

    expect(source.requests).toEqual([[BTC.instrument, WBTC.instrument]]);
    expect(view.pricing).toEqual({
      requestedSource: 'deterministic-prices',
      requestedAtMs: 1_000,
      receivedAtMs: 1_025,
      requestedCount: 2,
      pricedCount: 2,
      unpricedCount: 0,
      sources: [{ source: 'coinbase', quality: 'venue_reported_last', pricedCount: 2 }],
      status: 'complete',
    });
    expect(view.asOfMs).toBe(1_025);
    expect(view.valuation).toEqual({
      totalValueUsd: '175',
      totalCostUsd: '150',
      pricedCostUsd: '150',
      totalUnrealizedPnlUsd: '25',
      totalUnrealizedPnlPct: 100 / 6,
      pricedCount: 2,
      unpricedCount: 0,
    });
    expect(view.holdings.map((holding) => [holding.asset.instrument.productId, holding.valueUsd]))
      .toEqual([['BTC-USD', '150'], ['WBTC-USD', '25']]);
    expect(view.holdings[0]?.priceProvenance).toEqual({
      source: 'coinbase',
      quality: 'venue_reported_last',
      observedAtMs: 900,
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.holdings)).toBe(true);
    expect(Object.isFrozen(view.holdings[0]?.asset.instrument)).toBe(true);
    expect(Object.isFrozen(view.holdings[0]?.priceProvenance)).toBe(true);
    expect(Object.isFrozen(view.pricing)).toBe(true);
    database.close();
  });

  it('preserves partial pricing and blocks every rebalance estimate', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(2_000);
    insertTaxLots([
      lot('btc', BTC, '1', '40'),
      lot('wbtc', WBTC, '1', '30'),
    ], database);
    saveAllocationPolicy({
      targets: [
        { instrument: BTC.instrument, weight: 0.5 },
        { instrument: WBTC.instrument, weight: 0.5 },
      ],
      rebalanceBandPct: 5,
    }, database);
    const source = new FakePriceSource(async () => new Map([
      [instrumentKey(BTC.instrument), observedPrice('100')],
    ]));

    const view = await new PortfolioReadModelService({ database, clock, priceSource: source })
      .allocationView();

    expect(view.portfolio.pricing.status).toBe('partial');
    expect(view.portfolio.valuation).toEqual(expect.objectContaining({
      totalValueUsd: '100',
      totalCostUsd: '70',
      pricedCostUsd: '40',
      pricedCount: 1,
      unpricedCount: 1,
    }));
    expect(view.allocation.slices.find(
      (slice) => slice.asset.instrument.productId === 'WBTC-USD',
    )?.driftPct).toBeNull();
    expect(view.planStatus).toBe('blocked_incomplete_pricing');
    expect(view.plan).toEqual({
      trades: [],
      turnoverUsd: '0',
      maxDriftPct: 0,
      asOf: 2_000,
      estimateOnly: true,
    });
    database.close();
  });

  it('ignores malformed, zero, and unrequested provider values', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(3_000);
    insertTaxLots([
      lot('btc', BTC, '1', '40'),
      lot('wbtc', WBTC, '1', '30'),
    ], database);
    const unsafe = new Map<string, SpotPriceObservation>([
      [instrumentKey(BTC.instrument), {
        ...observedPrice('1'),
        priceUsd: '01' as SpotPriceObservation['priceUsd'],
      }],
      [instrumentKey(WBTC.instrument), {
        ...observedPrice('1'),
        priceUsd: decimal('0'),
      }],
      [instrumentKey(ETH.instrument), observedPrice('999')],
    ]);
    const source = new FakePriceSource(async () => unsafe);

    const view = await new PortfolioReadModelService({ database, clock, priceSource: source })
      .portfolioView();

    expect(view.pricing).toEqual(expect.objectContaining({
      status: 'unavailable',
      requestedCount: 2,
      pricedCount: 0,
      unpricedCount: 2,
    }));
    expect(view.holdings.every((holding) => holding.priceUsd === null)).toBe(true);
    database.close();
  });

  it('rejects malformed observation provenance instead of relabeling it', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(3_500);
    insertTaxLots([
      lot('btc', BTC, '1', '40'),
      lot('wbtc', WBTC, '1', '30'),
    ], database);
    const unsafe = new Map<string, SpotPriceObservation>([
      [instrumentKey(BTC.instrument), {
        ...observedPrice('100'),
        source: '   ',
      }],
      [instrumentKey(WBTC.instrument), {
        ...observedPrice('100'),
        observedAtMs: Number.MAX_SAFE_INTEGER + 1,
      }],
    ]);

    const view = await new PortfolioReadModelService({
      database,
      clock,
      priceSource: new FakePriceSource(async () => unsafe),
    }).portfolioView();

    expect(view.pricing.status).toBe('unavailable');
    expect(view.pricing.sources).toEqual([]);
    expect(view.holdings.every((holding) => holding.priceProvenance === null)).toBe(true);
    database.close();
  });

  it('contains provider failures without exposing diagnostic or secret data', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(4_000);
    insertTaxLots([lot('btc', BTC, '1', '40')], database);
    const source = new FakePriceSource(async () => {
      clock.advanceBy(10);
      throw new Error('token=top-secret provider diagnostic');
    }, 'failed-source');

    const view = await new PortfolioReadModelService({ database, clock, priceSource: source })
      .portfolioView();

    expect(view.pricing).toEqual({
      requestedSource: 'failed-source',
      requestedAtMs: 4_000,
      receivedAtMs: 4_010,
      requestedCount: 1,
      pricedCount: 0,
      unpricedCount: 1,
      sources: [],
      status: 'failed',
    });
    expect(view.holdings[0]?.priceUsd).toBeNull();
    expect(JSON.stringify(view)).not.toContain('top-secret');
    expect(Object.isFrozen(view.valuation)).toBe(true);
    database.close();
  });

  it('does not call the source for an empty portfolio', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(5_000);
    const source = new FakePriceSource(async () => {
      throw new Error('must not be called');
    });

    const view = await new PortfolioReadModelService({ database, clock, priceSource: source })
      .portfolioView();

    expect(source.requests).toEqual([]);
    expect(view.pricing).toEqual(expect.objectContaining({
      status: 'not_required',
      requestedCount: 0,
      pricedCount: 0,
      unpricedCount: 0,
    }));
    expect(view.holdings).toEqual([]);
    database.close();
  });

  it('uses a complete stored policy only for estimate-only plans', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(6_000);
    insertTaxLots([
      lot('btc', BTC, '1', '40'),
      lot('wbtc', WBTC, '1', '40'),
    ], database);
    const policy = {
      targets: [
        { instrument: BTC.instrument, weight: 0.5 },
        { instrument: WBTC.instrument, weight: 0.5 },
      ],
      rebalanceBandPct: 5,
    } as const;
    saveAllocationPolicy(policy, database);
    const source = new FakePriceSource(async () => new Map([
      [instrumentKey(BTC.instrument), observedPrice('80')],
      [instrumentKey(WBTC.instrument), observedPrice('20')],
    ]));

    const view = await new PortfolioReadModelService({ database, clock, priceSource: source })
      .allocationView();

    expect(view.policy).toEqual(policy);
    expect(view.planStatus).toBe('available');
    expect(view.plan.estimateOnly).toBe(true);
    expect(view.plan.trades.map((trade) => trade.side).sort()).toEqual(['buy', 'sell']);
    expect(Object.isFrozen(view.plan.trades)).toBe(true);
    database.close();
  });

  it('keeps mixed-source valuation complete but blocks non-venue rebalance estimates', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(6_500);
    insertTaxLots([
      lot('btc', BTC, '1', '40'),
      lot('wbtc', WBTC, '1', '40'),
    ], database);
    saveAllocationPolicy({
      targets: [
        { instrument: BTC.instrument, weight: 0.5 },
        { instrument: WBTC.instrument, weight: 0.5 },
      ],
      rebalanceBandPct: 5,
    }, database);
    const source = new FakePriceSource(async () => new Map([
      [instrumentKey(BTC.instrument), observedPrice('80')],
      [
        instrumentKey(WBTC.instrument),
        observedPrice('20', 'coingecko', 'reference_market'),
      ],
    ]), 'coinbase+coingecko');

    const view = await new PortfolioReadModelService({ database, clock, priceSource: source })
      .allocationView();

    expect(view.portfolio.pricing).toEqual(expect.objectContaining({
      requestedSource: 'coinbase+coingecko',
      status: 'complete',
      sources: [
        { source: 'coinbase', quality: 'venue_reported_last', pricedCount: 1 },
        { source: 'coingecko', quality: 'reference_market', pricedCount: 1 },
      ],
    }));
    expect(view.portfolio.valuation.totalValueUsd).toBe('100');
    expect(view.planStatus).toBe('blocked_non_venue_pricing');
    expect(view.plan.trades).toEqual([]);
    database.close();
  });

  it('blocks plans when a target has no real holding instead of synthesizing one', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(7_000);
    insertTaxLots([lot('btc', BTC, '1', '40')], database);
    saveAllocationPolicy({
      targets: [
        { instrument: BTC.instrument, weight: 0.5 },
        { instrument: ETH.instrument, weight: 0.5 },
      ],
      rebalanceBandPct: 5,
    }, database);
    const source = new FakePriceSource(async () => new Map([
      [instrumentKey(BTC.instrument), observedPrice('80')],
    ]));

    const view = await new PortfolioReadModelService({ database, clock, priceSource: source })
      .allocationView();

    expect(view.portfolio.pricing.status).toBe('complete');
    expect(view.planStatus).toBe('blocked_target_coverage');
    expect(view.plan.trades).toEqual([]);
    database.close();
  });

  it('reports no policy without generating strategy defaults', async () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(8_000);
    insertTaxLots([lot('btc', BTC, '1', '40')], database);
    const source = new FakePriceSource(async () => new Map([
      [instrumentKey(BTC.instrument), observedPrice('80')],
    ]));

    const view = await new PortfolioReadModelService({ database, clock, priceSource: source })
      .allocationView();

    expect(view.policy.targets).toEqual([]);
    expect(view.planStatus).toBe('no_policy');
    expect(view.plan.trades).toEqual([]);
    database.close();
  });

  it('rejects an unnamed price source before reading storage', () => {
    const database = openDatabase(':memory:');
    const clock = new FixedClock(9_000);
    const source = new FakePriceSource(async () => new Map(), '   ');
    expect(() => new PortfolioReadModelService({ database, clock, priceSource: source }))
      .toThrow('Price source must have a name');
    database.close();
  });
});
