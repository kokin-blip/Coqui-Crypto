import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  FixedClock,
  type AllocationPolicy,
  type AssetRef,
  type Holding,
  type InstrumentIdentity,
  type MarketBar,
  type ProductRuleSnapshot,
  type UsdAmount,
} from '../packages/core/src/index.js';
import {
  createPaperRunLoopTask,
  recoverPaperOrdersAtStartup,
  runPaperDecision,
  type PaperMarketData,
  type PaperRunLoopDependencies,
} from '../packages/services/src/index.js';
import {
  activateWalletSafetyStop,
  bootstrapPaperBalances,
  countCompletedDecisionRuns,
  listWalletRunAudits,
  openDatabase,
  type Db,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const PROFILE = 'main';

const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
const BTC_KEY = instrumentKey(BTC);
const BTC_REF: AssetRef = {
  instrument: BTC,
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};

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

const ETH: InstrumentIdentity = { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' };
const ETH_KEY = instrumentKey(ETH);
const ETH_REF: AssetRef = { ...BTC_REF, instrument: ETH, symbol: 'ETH', baseAsset: 'ETH' };

const POLICY: AllocationPolicy = {
  targets: [
    { instrument: BTC, weight: 0.5 },
    { instrument: ETH, weight: 0.5 },
  ],
  rebalanceBandPct: 1,
};

function bars(days: number): MarketBar[] {
  return Array.from({ length: days }, (_, index) => ({
    assetId: BTC_KEY,
    source: 'coinbase' as const,
    interval: '1d' as const,
    startTimeMs: T0 + index * DAY,
    endTimeMs: T0 + (index + 1) * DAY,
    open: 100 + index,
    high: 120 + index,
    low: 90 + index,
    close: 110 + index,
    volume: 100,
    isComplete: true,
    retrievedAtMs: T0,
  }));
}

const MARKET: PaperMarketData = { bars: () => bars(30), rules: () => RULES };

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

/** Deliberately imbalanced against a 50/50 target, so rebalancing has work. */
function holdings(): readonly Holding[] {
  return [
    holding(BTC_REF, '100.00', '1.00000000'),
    holding(ETH_REF, '900.00', '9.00000000'),
  ];
}

function deps(db: Db, clock: FixedClock, overrides: Partial<PaperRunLoopDependencies> = {}) {
  return {
    database: db,
    clock,
    profileId: PROFILE,
    market: MARKET,
    holdings,
    policy: () => POLICY,
    historicalNetEdgeEstimatePct: 12,
    ...overrides,
  } satisfies PaperRunLoopDependencies;
}

function seeded(): Db {
  const db = openDatabase(':memory:');
  bootstrapPaperBalances(
    PROFILE,
    [
      { assetId: 'USD', quantity: '10000' },
      // Seeded so a rebalance sell has something to settle against.
      { assetId: ETH_KEY, quantity: '9' },
    ],
    'seed',
    T0,
    db,
  );
  return db;
}

describe('every run is recorded, including one that trades nothing', () => {
  it('records a decision run when the kill switch halts it', () => {
    const db = seeded();
    activateWalletSafetyStop(
      { eventId: 'e1', profileId: PROFILE, kind: 'manual_kill', reason: 'halted', at: T0 },
      db,
    );

    const summary = runPaperDecision(deps(db, new FixedClock(T0 + DAY)), T0 + DAY);
    expect(summary.standDown).toBe('kill_switch_engaged');
    expect(summary.filledCount).toBe(0);

    // The engine ran and correctly declined, so the day is observed. A day it
    // never ran would not be — that is the "never elapsed empty days" rule.
    expect(countCompletedDecisionRuns(PROFILE, 0, db)).toBe(1);
    const audits = listWalletRunAudits(PROFILE, 50, db);
    expect(audits.map((audit) => audit.kind)).toContain('kill_switch');
    db.close();
  });

  it('records a stand-down when there is no policy to drift from', () => {
    const db = seeded();
    const summary = runPaperDecision(
      deps(db, new FixedClock(T0 + DAY), { policy: () => null }),
      T0 + DAY,
    );
    expect(summary.standDown).toBe('no_policy');
    expect(countCompletedDecisionRuns(PROFILE, 0, db)).toBe(1);
    db.close();
  });

  it('records a gate refusal with the gate that stopped it', () => {
    const db = seeded();
    // An edge below the cost model means profitability filters everything.
    const summary = runPaperDecision(
      deps(db, new FixedClock(T0 + DAY), { historicalNetEdgeEstimatePct: 0 }),
      T0 + DAY,
    );
    expect(summary.standDown).toBe('gates_refused');

    const gateAudit = listWalletRunAudits(PROFILE, 50, db).find((a) => a.kind === 'gates');
    expect(gateAudit?.status).toBe('refused');
    expect(JSON.parse(gateAudit!.detailJson)).toMatchObject({ gate: 'profitability' });
    db.close();
  });

  it('journals no raw error text, only stable codes', () => {
    const db = seeded();
    runPaperDecision(deps(db, new FixedClock(T0 + DAY), { historicalNetEdgeEstimatePct: 0 }), T0 + DAY);
    const journal = JSON.stringify(listWalletRunAudits(PROFILE, 50, db));
    expect(journal).not.toMatch(/Error|stack|\/Users\//u);
    expect(journal).toContain('paperOnly');
    db.close();
  });
});

describe('a trading run', () => {
  it('fills and journals the orders', () => {
    const db = seeded();
    const summary = runPaperDecision(deps(db, new FixedClock(T0 + DAY)), T0 + DAY);

    expect(summary.standDown).toBeNull();
    expect(summary.filledCount).toBeGreaterThan(0);

    const orders = listWalletRunAudits(PROFILE, 50, db).find((a) => a.kind === 'orders');
    expect(orders?.status).toBe('placed');
    db.close();
  });
});

describe('the 7-day unattended run', () => {
  it('completes seven observed days with a journal entry for each', () => {
    // The P6 exit criterion, driven deterministically through an injected
    // clock. Seven real days would prove the same thing once; this proves it
    // on every commit.
    const db = seeded();
    const summaries = [];
    for (let day = 1; day <= 7; day += 1) {
      const at = T0 + day * DAY;
      summaries.push(runPaperDecision(deps(db, new FixedClock(at)), at));
    }

    expect(summaries).toHaveLength(7);
    // Seven distinct scheduled slots — the observed-days counter.
    expect(countCompletedDecisionRuns(PROFILE, 0, db)).toBe(7);

    const runIds = new Set(summaries.map((summary) => summary.runId));
    expect(runIds.size).toBe(7);

    const journal = listWalletRunAudits(PROFILE, 200, db);
    expect(journal.filter((audit) => audit.kind === 'paper_run')).toHaveLength(7);
    db.close();
  });

  it('is replay-safe, so a repeated tick does not double-count a day', () => {
    const db = seeded();
    const at = T0 + DAY;
    runPaperDecision(deps(db, new FixedClock(at)), at);
    runPaperDecision(deps(db, new FixedClock(at)), at);

    // The run id is derived from profile and slot, so the same slot is the
    // same run. A scheduler that fires twice must not inflate the evidence.
    expect(countCompletedDecisionRuns(PROFILE, 0, db)).toBe(1);
    db.close();
  });

  it('recovers interrupted orders at startup rather than guessing', () => {
    const db = seeded();
    runPaperDecision(deps(db, new FixedClock(T0 + DAY)), T0 + DAY);

    const recovered = recoverPaperOrdersAtStartup({
      database: db,
      clock: new FixedClock(T0 + 2 * DAY),
      profileId: PROFILE,
    });
    // Everything settled, so nothing is left ambiguous.
    expect(recovered.blocked).toBe(0);
    db.close();
  });
});

describe('scheduler task contract', () => {
  it('reports completed for a stand-down, not degraded', async () => {
    const db = seeded();
    const task = createPaperRunLoopTask(
      deps(db, new FixedClock(T0 + DAY), { policy: () => null }),
    );
    const outcome = await task.execute({ scheduledForMs: T0 + DAY });

    // The scheduler outcome says whether the task ran, not whether it traded —
    // and its validation forbids a reason code on 'completed'.
    expect(outcome).toEqual({ status: 'completed' });
    db.close();
  });

  it('reports degraded with a reason code when the run throws', async () => {
    const db = seeded();
    const seen: unknown[] = [];
    const task = createPaperRunLoopTask(
      deps(db, new FixedClock(T0 + DAY), {
        holdings: () => {
          throw new Error('holdings unavailable');
        },
        onUnexpectedError: (_context, error) => seen.push(error),
      }),
    );

    const outcome = await task.execute({ scheduledForMs: T0 + DAY });
    expect(outcome).toEqual({ status: 'degraded', reasonCode: 'paper_run_failed' });
    expect(seen).toHaveLength(1);
    db.close();
  });

  it('defaults to a daily UTC cadence', () => {
    const db = seeded();
    const task = createPaperRunLoopTask(deps(db, new FixedClock(T0)));
    expect(task.cadenceMs).toBe(DAY);
    expect(task.profileId).toBe(PROFILE);
    db.close();
  });
});
