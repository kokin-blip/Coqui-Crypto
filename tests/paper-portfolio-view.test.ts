import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  FixedClock,
  type AllocationPolicy,
  type AssetRef,
  type Holding,
  type InstrumentIdentity,
  type MarketBar,
  type PriceSource,
  type ProductRuleSnapshot,
  type UsdAmount,
} from '../packages/core/src/index.js';
import {
  paperPortfolioView,
  runPaperDecision,
  type PaperMarketData,
  type PaperRunLoopDependencies,
} from '../packages/services/src/index.js';
import {
  activateWalletSafetyStop,
  bootstrapPaperBalances,
  openDatabase,
  type Db,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const PROFILE = 'main';

const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
const BTC_KEY = instrumentKey(BTC);
const ETH: InstrumentIdentity = { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' };
const ETH_KEY = instrumentKey(ETH);

const BTC_REF: AssetRef = {
  instrument: BTC,
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};
const ETH_REF: AssetRef = { ...BTC_REF, instrument: ETH, symbol: 'ETH', baseAsset: 'ETH' };

const RULES: ProductRuleSnapshot = {
  id: 'a'.repeat(64),
  instrument: BTC,
  status: 'online',
  tradingDisabled: false,
  cancelOnly: false,
  limitOnly: false,
  postOnly: false,
  viewOnly: false,
  baseIncrement: '0.00000001',
  quoteIncrement: '0.01',
  priceIncrement: '0.01',
  baseMinSize: '0.00000001',
  baseMaxSize: null,
  quoteMinSize: '1',
  quoteMaxSize: null,
  source: 'coinbase',
  retrievedAt: T0,
  responseHash: 'b'.repeat(64),
};

const POLICY: AllocationPolicy = {
  targets: [
    { instrument: BTC, weight: 0.5 },
    { instrument: ETH, weight: 0.5 },
  ],
  rebalanceBandPct: 1,
};

function bars(): MarketBar[] {
  return Array.from({ length: 30 }, (_, index) => ({
    assetId: BTC_KEY,
    source: 'coinbase' as const,
    interval: '1d' as const,
    startTimeMs: T0 + index * DAY,
    endTimeMs: T0 + (index + 1) * DAY,
    open: 100 + index,
    high: 130 + index,
    low: 80 + index,
    close: 110 + index,
    volume: 100,
    isComplete: true,
    retrievedAtMs: T0,
  }));
}

function holding(asset: AssetRef, valueUsd: string, quantity: string): Holding {
  return {
    asset,
    quantity: quantity as Holding['quantity'],
    avgCostUsd: '100.00' as UsdAmount,
    priceUsd: '110.00' as UsdAmount,
    valueUsd: valueUsd as UsdAmount,
    unrealizedPnlUsd: '0' as UsdAmount,
    unrealizedPnlPct: 0,
  };
}

/** Prices whatever it is asked for, so pricing is never the thing under test. */
function priceSource(prices: Record<string, string>): PriceSource {
  return {
    name: 'test',
    async spot(instruments: readonly InstrumentIdentity[]) {
      const observed = new Map<string, { priceUsd: string; source: string; quality: 'venue'; observedAtMs: number }>();
      for (const instrument of instruments) {
        const key = instrumentKey(instrument);
        const price = prices[key];
        if (price === undefined) continue;
        observed.set(key, { priceUsd: price, source: 'test', quality: 'venue', observedAtMs: T0 });
      }
      return observed;
    },
  } as unknown as PriceSource;
}

function seeded(): Db {
  const db = openDatabase(':memory:');
  bootstrapPaperBalances(
    PROFILE,
    [
      { assetId: 'USD', quantity: '10000' },
      { assetId: ETH_KEY, quantity: '9' },
    ],
    'seed',
    T0,
    db,
  );
  return db;
}

function runOnce(db: Db): void {
  const deps: PaperRunLoopDependencies = {
    database: db,
    clock: new FixedClock(T0 + DAY),
    profileId: PROFILE,
    market: { bars: () => bars(), rules: () => RULES } satisfies PaperMarketData,
    holdings: () => [holding(BTC_REF, '100.00', '1'), holding(ETH_REF, '900.00', '9')],
    policy: () => POLICY,
    historicalNetEdgeEstimatePct: 12,
  };
  runPaperDecision(deps, T0 + DAY);
}

describe('the paper figure is a simulation, and says so', () => {
  it('carries a literal simulation marker no surface can drop', async () => {
    const db = seeded();
    const view = await paperPortfolioView(
      { database: db, clock: new FixedClock(T0 + DAY), priceSource: priceSource({ [ETH_KEY]: '100' }) },
      PROFILE,
    );
    // A boolean could be flipped by a caller; a literal type cannot be anything
    // else, which is the point — this figure must never be presented as money.
    expect(view.simulation).toBe(true);
    db.close();
  });

  it('values cash plus priced positions', async () => {
    const db = seeded();
    const view = await paperPortfolioView(
      { database: db, clock: new FixedClock(T0 + DAY), priceSource: priceSource({ [ETH_KEY]: '100' }) },
      PROFILE,
    );
    // 10,000 cash + 9 ETH at 100.
    expect(view.totalValueUsd).toBe('10900.00');
    expect(view.unpricedCount).toBe(0);
    db.close();
  });
});

describe('an unpriced simulated position withholds the total', () => {
  it('reports null rather than an understated number', async () => {
    const db = seeded();
    const view = await paperPortfolioView(
      // ETH deliberately unpriced.
      { database: db, clock: new FixedClock(T0 + DAY), priceSource: priceSource({}) },
      PROFILE,
    );
    // Omitting the position would quietly understate the simulation and flatter
    // whichever side of the comparison is missing a price.
    expect(view.totalValueUsd).toBeNull();
    expect(view.unpricedCount).toBe(1);
    expect(view.positions[0]?.valueUsd).toBeNull();
    db.close();
  });

  it('still reports the position and its quantity', async () => {
    const db = seeded();
    const view = await paperPortfolioView(
      { database: db, clock: new FixedClock(T0 + DAY), priceSource: priceSource({}) },
      PROFILE,
    );
    expect(view.positions).toHaveLength(1);
    expect(view.positions[0]?.quantity).toBe('9');
    db.close();
  });
});

describe('the latest run is explained, including a stand-down', () => {
  it('reports what the run did', async () => {
    const db = seeded();
    runOnce(db);
    const view = await paperPortfolioView(
      { database: db, clock: new FixedClock(T0 + 2 * DAY), priceSource: priceSource({ [ETH_KEY]: '100' }) },
      PROFILE,
    );
    expect(view.lastRun?.scheduledForMs).toBe(T0 + DAY);
    expect(view.lastRun?.standDown).toBeNull();
    expect(view.lastRun?.filled).toBeGreaterThan(0);
    db.close();
  });

  it('names the halt when the kill switch stood the run down', async () => {
    const db = seeded();
    activateWalletSafetyStop(
      { eventId: 'e1', profileId: PROFILE, kind: 'manual_kill', reason: 'manual test halt', at: T0 },
      db,
    );
    runOnce(db);

    const view = await paperPortfolioView(
      { database: db, clock: new FixedClock(T0 + 2 * DAY), priceSource: priceSource({ [ETH_KEY]: '100' }) },
      PROFILE,
    );
    // The blocked state the screen must be able to show: a run happened and
    // deliberately placed nothing.
    expect(view.lastRun?.standDown).toBe('kill_switch_engaged');
    expect(view.lastRun?.filled).toBe(0);
    db.close();
  });

  it('has no run to report before the engine has ever run', async () => {
    const db = seeded();
    const view = await paperPortfolioView(
      { database: db, clock: new FixedClock(T0), priceSource: priceSource({ [ETH_KEY]: '100' }) },
      PROFILE,
    );
    expect(view.lastRun).toBeNull();
    db.close();
  });
});

describe('the sample behind the comparison travels with it', () => {
  it('carries the forward-evidence counters', async () => {
    const db = seeded();
    runOnce(db);
    const view = await paperPortfolioView(
      { database: db, clock: new FixedClock(T0 + 2 * DAY), priceSource: priceSource({ [ETH_KEY]: '100' }) },
      PROFILE,
    );
    expect(view.evidence.evidence.decisions).toBe(1);
    expect(view.evidence.allRequirementsMet).toBe(false);
    // One day of evidence cannot make live trading permitted, and the type says
    // so rather than the caller remembering to.
    expect(view.evidence.liveExecutionPermitted).toBe(false);
    db.close();
  });
});
