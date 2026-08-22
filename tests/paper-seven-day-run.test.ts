import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  type AllocationPolicy,
  type AssetRef,
  type Clock,
  type Holding,
  type InstrumentIdentity,
  type InstrumentKey,
  type MarketBar,
  type ProductRuleSnapshot,
  type UsdAmount,
} from '../packages/core/src/index.js';
import {
  forwardPaperEvidence,
  recoverPaperOrdersAtStartup,
  reconcilePaperFills,
  runPaperDecision,
  type PaperMarketData,
  type PaperRunLoopDependencies,
} from '../packages/services/src/index.js';
import {
  bootstrapPaperBalances,
  countObservedDecisionDays,
  countPaperFills,
  listPaperBalances,
  listWalletRunAudits,
  openDatabase,
  type Db,
} from '../packages/storage/src/index.js';

/**
 * The P6 exit criterion: seven unattended days, driven by a simulated clock.
 *
 * `docs/PLAN.md` P6 requires a 7-day run with a complete journal, correct
 * forward counters, interrupted orders recovered on restart, and a
 * reconciliation harness that reports a quantified divergence. This is the
 * deterministic half of that — the real multi-day run against live Coinbase
 * bars is recorded separately as a study, and cannot be a CI gate because it
 * takes a week and depends on a venue being up.
 *
 * Everything here is driven, never waited on. The clock is stepped by hand, so
 * the whole week runs in milliseconds and the same input always produces the
 * same journal.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 5, 1);
const DAYS = 7;
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

function rules(instrument: InstrumentIdentity, id: string): ProductRuleSnapshot {
  return {
    id,
    instrument,
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
}

const RULES = new Map<string, ProductRuleSnapshot>([
  [BTC_KEY, rules(BTC, 'a'.repeat(64))],
  [ETH_KEY, rules(ETH, 'c'.repeat(64))],
]);

const POLICY: AllocationPolicy = {
  targets: [
    { instrument: BTC, weight: 0.5 },
    { instrument: ETH, weight: 0.5 },
  ],
  rebalanceBandPct: 1,
};

/**
 * Bars covering a warm-up window and every day of the run.
 *
 * `shiftPct` restates the whole series, which is how the reconciliation case
 * simulates a provider correcting itself after the fills were recorded.
 */
function bars(key: string, shiftPct = 0): MarketBar[] {
  const base = key === BTC_KEY ? 100 : 20;
  const scale = 1 + shiftPct / 100;
  return Array.from({ length: 40 + DAYS }, (_, index) => {
    const drift = base + index * (base / 100);
    return {
      assetId: key as InstrumentKey,
      source: 'coinbase' as const,
      interval: '1d' as const,
      startTimeMs: T0 - 40 * DAY + index * DAY,
      endTimeMs: T0 - 39 * DAY + index * DAY,
      open: drift * scale,
      high: drift * 1.05 * scale,
      low: drift * 0.95 * scale,
      close: drift * 1.02 * scale,
      volume: 1_000,
      isComplete: true,
      retrievedAtMs: T0,
    };
  });
}

const MARKET: PaperMarketData = {
  bars: (key) => bars(key),
  rules: (key) => RULES.get(key) ?? null,
};

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

class StepClock implements Clock {
  #now: number;
  constructor(now: number) {
    this.#now = now;
  }
  nowMs(): number {
    return this.#now;
  }
  set(at: number): void {
    this.#now = at;
  }
}

function seeded(): Db {
  const db = openDatabase(':memory:');
  bootstrapPaperBalances(
    PROFILE,
    [
      { assetId: 'USD', quantity: '50000' },
      { assetId: BTC_KEY, quantity: '1' },
      { assetId: ETH_KEY, quantity: '400' },
    ],
    'seed',
    T0 - DAY,
    db,
  );
  return db;
}

/**
 * Run the week.
 *
 * The holdings stay deliberately imbalanced — heavily ETH against a 50/50
 * target — so the allocation planner has something to propose every day. A
 * portfolio already on target would stand down correctly and prove nothing
 * about the journal.
 */
function runWeek(db: Db, clock: StepClock): void {
  const dependencies: PaperRunLoopDependencies = {
    database: db,
    clock,
    profileId: PROFILE,
    market: MARKET,
    holdings: () => [holding(BTC_REF, '100.00', '1'), holding(ETH_REF, '9000.00', '400')],
    policy: () => POLICY,
    // Supplied by the harness, not by the app. The composition root defaults to
    // zero because no study has registered an estimate for the shipped
    // strategy; a run that never fills could not exercise fills or
    // reconciliation, so the harness states its own assumption explicitly.
    historicalNetEdgeEstimatePct: 15,
  };

  for (let day = 0; day < DAYS; day += 1) {
    const slot = T0 + day * DAY;
    clock.set(slot);
    runPaperDecision(dependencies, slot);
  }
}

describe('seven unattended days', () => {
  it('records one completed decision per day', () => {
    const db = seeded();
    runWeek(db, new StepClock(T0));

    // Observed days count days the engine *decided*, including a decision to do
    // nothing — never elapsed calendar days.
    expect(countObservedDecisionDays(PROFILE, 0, db)).toBe(DAYS);
    db.close();
  });

  it('journals every run, and the journal is append-only', () => {
    const db = seeded();
    runWeek(db, new StepClock(T0));

    const audits = listWalletRunAudits(PROFILE, 200, db);
    const runs = audits.filter((audit) => audit.kind === 'paper_run');
    expect(runs).toHaveLength(DAYS);
    expect(runs.every((audit) => audit.status === 'completed')).toBe(true);

    // Order placement is journalled separately from the run outcome, so a run
    // that placed nothing is distinguishable from a run that never happened.
    expect(audits.filter((audit) => audit.kind === 'orders').length).toBeGreaterThan(0);
    db.close();
  });

  it('fills against the next bar and moves the simulated balances', () => {
    const db = seeded();
    runWeek(db, new StepClock(T0));

    const fills = countPaperFills(PROFILE, 0, db);
    expect(fills).toBeGreaterThan(0);

    const balances = listPaperBalances(PROFILE, db);
    const btc = balances.find((balance) => balance.assetId === BTC_KEY);
    // The plan is ETH-heavy against a 50/50 target, so the week buys BTC.
    expect(Number(btc?.quantity ?? '0')).toBeGreaterThan(1);
    db.close();
  });

  it('replaying a day changes nothing', () => {
    const db = seeded();
    const clock = new StepClock(T0);
    runWeek(db, clock);
    const before = countPaperFills(PROFILE, 0, db);

    // A restart, a lease expiry or a clock adjustment can fire the same slot
    // twice. A decided slot stays decided; re-deciding would place a second set
    // of orders against a market that has since moved.
    runWeek(db, clock);

    expect(countPaperFills(PROFILE, 0, db)).toBe(before);
    expect(countObservedDecisionDays(PROFILE, 0, db)).toBe(DAYS);
    expect(
      listWalletRunAudits(PROFILE, 200, db).filter((audit) => audit.kind === 'paper_run'),
    ).toHaveLength(DAYS);
    db.close();
  });

  it('reports the week as forward evidence, still far short of the bar', () => {
    const db = seeded();
    const clock = new StepClock(T0);
    runWeek(db, clock);

    const evidence = forwardPaperEvidence({ database: db, clock }, PROFILE);
    expect(evidence.evidence.days).toBe(DAYS);
    expect(evidence.evidence.decisions).toBe(DAYS);
    // Seven days is not ninety. The point of the counters is that a week of
    // green cannot be mistaken for a validated strategy.
    expect(evidence.allRequirementsMet).toBe(false);
    expect(evidence.liveExecutionPermitted).toBe(false);
    db.close();
  });
});

describe('a restart mid-week loses nothing', () => {
  it('recovers cleanly and carries on', () => {
    const db = seeded();
    const clock = new StepClock(T0);
    const dependencies: PaperRunLoopDependencies = {
      database: db,
      clock,
      profileId: PROFILE,
      market: MARKET,
      holdings: () => [holding(BTC_REF, '100.00', '1'), holding(ETH_REF, '9000.00', '400')],
      policy: () => POLICY,
      historicalNetEdgeEstimatePct: 15,
    };

    for (let day = 0; day < 3; day += 1) {
      clock.set(T0 + day * DAY);
      runPaperDecision(dependencies, T0 + day * DAY);
    }

    // The restart. Everything the OMS completed is terminal already, so
    // recovery has nothing ambiguous to classify — which is the outcome a clean
    // shutdown should produce, and worth asserting rather than assuming.
    clock.set(T0 + 3 * DAY);
    const recovery = recoverPaperOrdersAtStartup({ database: db, clock, profileId: PROFILE });
    expect(recovery.blocked).toBe(0);

    for (let day = 3; day < DAYS; day += 1) {
      clock.set(T0 + day * DAY);
      runPaperDecision(dependencies, T0 + day * DAY);
    }

    expect(countObservedDecisionDays(PROFILE, 0, db)).toBe(DAYS);
    db.close();
  });
});

describe('the week reconciles, and a restated week does not', () => {
  it('agrees with the backtest when nothing moved underneath', () => {
    const db = seeded();
    const clock = new StepClock(T0);
    runWeek(db, clock);

    clock.set(T0 + DAYS * DAY);
    const report = reconcilePaperFills({ database: db, clock, market: MARKET }, PROFILE, 0);

    expect(report.fillCount).toBeGreaterThan(0);
    expect(report.unverifiableCount).toBe(0);
    // The venue was built to match `backtest/engine.ts`, so agreement is the
    // expected result and a failure here means one of them drifted.
    expect(report.divergedCount).toBe(0);
    db.close();
  });

  it('reports a quantified divergence when the bars are restated', () => {
    const db = seeded();
    const clock = new StepClock(T0);
    runWeek(db, clock);

    clock.set(T0 + DAYS * DAY);
    const restated: PaperMarketData = {
      bars: (key) => bars(key, 3),
      rules: (key) => RULES.get(key) ?? null,
    };
    const report = reconcilePaperFills({ database: db, clock, market: restated }, PROFILE, 0);

    // Quantified in basis points, and signed, so a systematic bias is visible
    // rather than averaged away against itself. This is the P6 exit criterion:
    // the harness must be able to say *how far* off the model was.
    expect(report.divergedCount).toBe(report.fillCount);
    expect(report.meanPriceDivergenceBps).not.toBeNull();
    expect(Math.abs(report.worstPriceDivergenceBps ?? 0)).toBeGreaterThan(100);
    db.close();
  });
});
