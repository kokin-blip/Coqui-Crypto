import { describe, expect, it } from 'vitest';

import { createPaperMarketFeed } from '../apps/desktop/src/main/paper-market.js';
import { startSchedulerRuntime } from '../apps/desktop/src/main/scheduler-runtime.js';
import {
  decimal,
  instrumentKey,
  FixedClock,
  type AllocationPolicy,
  type Clock,
  type AssetRef,
  type Holding,
  type InstrumentIdentity,
  type MarketBar,
  type ProductRuleSnapshot,
  type UsdAmount,
} from '../packages/core/src/index.js';
import type { PaperRunLoopDependencies } from '../packages/services/src/index.js';
import {
  countCompletedDecisionRuns,
  getPaperOrder,
  openDatabase,
  savePaperOrder,
  saveProductRuleSnapshot,
  type Db,
} from '../packages/storage/src/index.js';
import { paperPreparation, seedPaperOrigin } from './support.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 8);
const PROFILE = 'main';

const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
const BTC_KEY = instrumentKey(BTC);
const ETH: InstrumentIdentity = { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' };
const PREPARATION = paperPreparation([BTC, ETH], T0);

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

function bars(count = 30): MarketBar[] {
  return Array.from({ length: count }, (_, index) => ({
    assetId: BTC_KEY,
    source: 'coinbase' as const,
    interval: '1d' as const,
    startTimeMs: T0 - (count - index) * DAY,
    endTimeMs: T0 - (count - index - 1) * DAY,
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

/**
 * A clock the test advances by hand.
 *
 * `ensureSchedules` writes the *next* UTC boundary, so a freshly scheduled task
 * is never due at the instant it is registered — advancing past that boundary is
 * how a tick becomes due without waiting a day.
 */
class StepClock implements Clock {
  #now: number;
  constructor(now: number) { this.#now = now; }
  nowMs(): number { return this.#now; }
  advance(ms: number): void { this.#now += ms; }
}

function seeded(): Db {
  const db = openDatabase(':memory:');
  seedPaperOrigin(db, PROFILE, [
    holding(BTC_REF, '100.00', '1'), holding(ETH_REF, '900.00', '9'),
  ], T0);
  return db;
}

function paperDeps(db: Db, clock: Clock = new FixedClock(T0)): PaperRunLoopDependencies {
  return {
    database: db,
    clock,
    profileId: PROFILE,
    market: { bars: () => bars(), rules: () => RULES },
    holdings: () => [holding(BTC_REF, '100.00', '1'), holding(ETH_REF, '900.00', '9')],
    policy: () => POLICY,
    preparation: () => PREPARATION,
    historicalGrossEdgeLowerBoundPct: 12,
  };
}

describe('the scheduler finally has a wake-up', () => {
  it('runs a due paper decision on a driven tick', async () => {
    const db = seeded();
    const clock = new StepClock(T0);
    const runtime = startSchedulerRuntime({
      database: db,
      clock,
      profileId: PROFILE,
      paper: paperDeps(db, clock),
      pollMs: 3_600_000,
    });

    clock.advance(DAY);
    await runtime.tick();

    // The whole point of B3: `WalletSchedulerService` had no production caller,
    // so no decision could ever be reached outside a test.
    expect(countCompletedDecisionRuns(PROFILE, 0, db)).toBe(1);
    runtime.dispose();
    db.close();
  });

  it('prepares before it decides', async () => {
    const db = seeded();
    const order: string[] = [];
    const clock = new StepClock(T0);
    const runtime = startSchedulerRuntime({
      database: db,
      clock,
      profileId: PROFILE,
      paper: {
        ...paperDeps(db, clock),
        holdings: () => {
          order.push('decide');
          return [holding(BTC_REF, '100.00', '1'), holding(ETH_REF, '900.00', '9')];
        },
      },
      prepare: async () => {
        order.push('prepare');
      },
      pollMs: 3_600_000,
    });

    clock.advance(DAY);
    await runtime.tick();

    // Preparation happens first. Once a paper origin exists, planning reads
    // the simulated ledger rather than repeatedly consulting real holdings.
    expect(order).toEqual(['prepare']);
    runtime.dispose();
    db.close();
  });

  it('still decides when preparation fails', async () => {
    const db = seeded();
    const failures: string[] = [];
    const clock = new StepClock(T0);
    const runtime = startSchedulerRuntime({
      database: db,
      clock,
      profileId: PROFILE,
      paper: paperDeps(db, clock),
      prepare: () => Promise.reject(new Error('network down')),
      onUnexpectedError: (context) => failures.push(context),
      pollMs: 3_600_000,
    });

    clock.advance(DAY);
    await runtime.tick();

    // Offline is not a reason to skip a day: the engine decides against the
    // bars it already has, and the venue refuses anything it cannot price.
    expect(failures).toContain('scheduler_prepare');
    expect(countCompletedDecisionRuns(PROFILE, 0, db)).toBe(1);
    runtime.dispose();
    db.close();
  });

  it('recovers interrupted orders before the first tick', () => {
    const db = seeded();
    saveProductRuleSnapshot(RULES, db);
    const base = {
      id: 'c'.repeat(64),
      profileId: PROFILE,
      runId: 'd'.repeat(64),
      instrument: BTC,
      side: 'buy' as const,
      requestedQuantity: decimal('0.1'),
      requestedNotional: decimal('11'),
      productRuleSnapshotId: RULES.id,
      decisionSnapshotHash: 'e'.repeat(64),
      reason: null,
      createdAt: T0 - DAY,
      updatedAt: T0 - DAY,
    };
    // Walked forward one legal transition at a time: a crash mid-submission is
    // the state that actually needs recovering, and it cannot be written
    // directly.
    for (const state of ['proposed', 'risk_approved', 'submission_pending', 'submitted'] as const) {
      savePaperOrder({ ...base, state }, db);
    }

    const runtime = startSchedulerRuntime({
      database: db,
      clock: new FixedClock(T0),
      profileId: PROFILE,
      paper: paperDeps(db),
      pollMs: 3_600_000,
    });

    // Submitted with no fill is ambiguous, so recovery marks it `unknown`
    // rather than guessing either way (invariant 15) — and it happens at
    // startup, before any tick could place a second order against it.
    const recovered = getPaperOrder('c'.repeat(64), db);
    expect(recovered?.state).toBe('unknown');
    runtime.dispose();
    db.close();
  });
});

describe('the market feed reads locally and fetches beforehand', () => {
  it('publishes a complete decision-grade preparation only after data and rules pass', async () => {
    const db = seeded();
    const feed = createPaperMarketFeed({
      database: db,
      http: {
        getJson: async () => ({
          ok: true,
          status: 200,
          data: [{
            id: 'BTC-USD', quote_currency: 'USD', status: 'online',
            base_increment: '0.00000001', quote_increment: '0.01',
            min_market_funds: '1', trading_disabled: false, cancel_only: false,
            limit_only: false, post_only: false,
          }],
        }),
      } as never,
      instruments: () => [BTC],
      bars: async () => ({ ok: true, bars: bars(121) }),
    });

    const result = await feed.refresh(T0 + 10 * 60_000);
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      datasetHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      latestCompletedStartMs: T0 - DAY,
      expectedCompletedStartMs: T0 - DAY,
      ruleSnapshotHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    }));
    expect(feed.preparation()).toEqual(result);
    db.close();
  });

  it('serves persisted bars synchronously after a refresh', async () => {
    const db = seeded();
    saveProductRuleSnapshot(RULES, db);
    const feed = createPaperMarketFeed({
      database: db,
      http: { getJson: async () => ({ ok: false, status: 0 }) } as never,
      instruments: () => [BTC],
      bars: async () => ({ ok: true, bars: bars() }),
    });

    await feed.refresh(T0 + 10 * 60_000);

    // Synchronous by design: the OMS reads bars while deciding.
    expect(feed.view.bars(BTC_KEY).length).toBe(30);
    expect(feed.view.rules(BTC_KEY)?.id).toBe(RULES.id);
    db.close();
  });

  it('accepts a freshly fetched rule whose immutable content snapshot already exists', async () => {
    const db = seeded();
    saveProductRuleSnapshot(RULES, db);
    const feed = createPaperMarketFeed({
      database: db,
      http: { getJson: async () => ({ ok: true, status: 200, data: [{
        id: 'BTC-USD', quote_currency: 'USD', status: 'online',
        base_increment: '0.00000001', quote_increment: '0.01', min_market_funds: '1',
        trading_disabled: false, cancel_only: false, limit_only: false, post_only: false,
      }] }) } as never,
      instruments: () => [BTC], bars: async () => ({ ok: true, bars: bars(121) }),
    });
    expect(await feed.refresh(T0 + 10 * 60_000)).toEqual(expect.objectContaining({ ok: true }));
    db.close();
  });

  it('refuses a product it has no rules for rather than assuming them', async () => {
    const db = seeded();
    const feed = createPaperMarketFeed({
      database: db,
      http: { getJson: async () => ({ ok: false, status: 0 }) } as never,
      instruments: () => [BTC],
      bars: async () => ({ ok: true, bars: bars() }),
    });

    await feed.refresh(T0 + 10 * 60_000);

    // Invariant 4: an absent rule is a refusal to trade, never a default one.
    expect(feed.view.rules(BTC_KEY)).toBeNull();
    db.close();
  });

  it('never persists an incomplete bar', async () => {
    const db = seeded();
    const partial = bars().map((bar, index) =>
      index === 29 ? { ...bar, isComplete: false } : bar,
    );
    const feed = createPaperMarketFeed({
      database: db,
      http: { getJson: async () => ({ ok: false, status: 0 }) } as never,
      instruments: () => [BTC],
      bars: async () => ({ ok: true, bars: partial }),
    });

    await feed.refresh(T0 + 10 * 60_000);

    // Invariant 6: the cheapest way to guarantee a signal never sees a partial
    // bar is never to store one.
    expect(feed.view.bars(BTC_KEY)).toHaveLength(29);
    db.close();
  });

  it('returns a typed stand-down when a fetch fails', async () => {
    const db = seeded();
    const failures: string[] = [];
    const feed = createPaperMarketFeed({
      database: db,
      http: { getJson: async () => ({ ok: false, status: 0 }) } as never,
      instruments: () => [BTC],
      bars: () => Promise.reject(new Error('offline')),
      onUnexpectedError: (context) => failures.push(context),
    });

    await expect(feed.refresh(T0)).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: 'market_fetch_failed',
      rulesFresh: false,
    }));
    expect(failures).toEqual([]);
    db.close();
  });
});
