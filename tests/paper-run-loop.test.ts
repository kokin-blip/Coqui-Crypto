import { describe, expect, it } from 'vitest';

import {
  strategyDecisionId,
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
  countCompletedDecisionRuns,
  countPaperFills,
  getStrategyDecision,
  listPaperBalances,
  listDecisionEvidenceEvents,
  listWalletRunAudits,
  openDatabase,
  setPaperExecutionPolicy,
  type Db,
} from '../packages/storage/src/index.js';
import { paperPreparation, seedPaperOrigin } from './support.js';

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
const PREPARATION = paperPreparation([BTC, ETH], T0);
const ETH_REF: AssetRef = { ...BTC_REF, instrument: ETH, symbol: 'ETH', baseAsset: 'ETH' };

const POLICY: AllocationPolicy = {
  targets: [
    { instrument: BTC, weight: 0.5 },
    { instrument: ETH, weight: 0.5 },
  ],
  rebalanceBandPct: 1,
};

function bars(days: number, assetId: string = BTC_KEY): MarketBar[] {
  return Array.from({ length: days }, (_, index) => ({
    assetId: assetId as never,
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

const MARKET: PaperMarketData = {
  bars: (key) => bars(30, key),
  rules: (key) => key === ETH_KEY
    ? { ...RULES, id: 'c'.repeat(64), instrument: ETH }
    : RULES,
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
    preparation: () => PREPARATION,
    historicalGrossEdgeLowerBoundPct: 12,
    evidenceVerified: () => true,
    ...overrides,
  } satisfies PaperRunLoopDependencies;
}

function seeded(): Db {
  const db = openDatabase(':memory:');
  seedPaperOrigin(db, PROFILE, holdings(), T0);
  setPaperExecutionPolicy({
    commandId: '00000000-0000-4000-8000-000000000001',
    profileId: PROFILE,
    mode: 'unattended',
    confirmedAt: T0,
    explicitUnattendedConfirmation: true,
  }, db);
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
    expect(summary.strategyVersion).toBe('allocation-policy-rebalancer-v1');
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
    const decisionId = strategyDecisionId(PROFILE, T0 + DAY);
    expect(getStrategyDecision(decisionId, db)?.decision).toMatchObject({
      decisionId,
      profileId: PROFILE,
      strategy: { version: 'allocation-policy-rebalancer-v1' },
      market: { freshness: 'fresh' },
      portfolio: { source: 'unavailable' },
    });
    expect(listDecisionEvidenceEvents(decisionId, PROFILE, db).map((event) => event.kind))
      .toEqual(['strategy_evaluated', 'stand_down']);
    db.close();
  });

  it('records a gate refusal with the gate that stopped it', () => {
    const db = seeded();
    // An edge below the cost model means profitability filters everything.
    const summary = runPaperDecision(
      deps(db, new FixedClock(T0 + DAY), { historicalGrossEdgeLowerBoundPct: 0 }),
      T0 + DAY,
    );
    expect(summary.standDown).toBe('gates_refused');

    const gateAudit = listWalletRunAudits(PROFILE, 50, db).find((a) => a.kind === 'execution');
    expect(gateAudit?.status).toBe('blocked');
    expect(JSON.parse(gateAudit!.detailJson)).toMatchObject({ reasonCode: 'all_intents_filtered' });
    const decisionId = strategyDecisionId(PROFILE, T0 + DAY);
    expect(listDecisionEvidenceEvents(decisionId, PROFILE, db).map((event) => event.kind))
      .toEqual(['strategy_evaluated', 'execution_planned', 'execution_refused']);
    db.close();
  });

  it('persists a typed stale-data decision before reading holdings or planning', () => {
    const db = seeded();
    const summary = runPaperDecision(deps(db, new FixedClock(T0 + DAY), {
      preparation: () => ({ ok: false, code: 'stale_market_data' }),
      holdings: () => { throw new Error('holdings must not be read'); },
    }), T0 + DAY);

    expect(summary.standDown).toBe('stale_market_data');
    const decisionId = strategyDecisionId(PROFILE, T0 + DAY);
    expect(getStrategyDecision(decisionId, db)?.decision.market).toMatchObject({
      freshness: 'stale',
      refreshResult: 'stale_market_data',
      rulesFresh: false,
    });
    expect(listDecisionEvidenceEvents(decisionId, PROFILE, db).map((event) => event.kind))
      .toEqual(['strategy_evaluated', 'stand_down']);
    expect(listWalletRunAudits(PROFILE, 50, db).filter((audit) => audit.kind === 'execution'))
      .toEqual([]);
    db.close();
  });

  it('journals no raw error text, only stable codes', () => {
    const db = seeded();
    runPaperDecision(deps(db, new FixedClock(T0 + DAY), { historicalGrossEdgeLowerBoundPct: 0 }), T0 + DAY);
    const journal = JSON.stringify(listWalletRunAudits(PROFILE, 50, db));
    expect(journal).not.toMatch(/Error|stack|\/Users\//u);
    expect(journal).toContain('paperOnly');
    db.close();
  });
});

describe('a trading run', () => {
  it('submits orders for the exact next open and journals them', () => {
    const db = seeded();
    const summary = runPaperDecision(deps(db, new FixedClock(T0 + DAY)), T0 + DAY);

    expect(summary.standDown).toBe('pending_settlement');
    expect(summary.submittedCount).toBeGreaterThan(0);
    expect(summary.filledCount).toBe(0);

    const decisionId = strategyDecisionId(PROFILE, T0 + DAY);
    const stored = getStrategyDecision(decisionId, db);
    expect(stored?.decision).toMatchObject({
      strategy: { id: 'trendvol', version: 'trendvol-paper-v1-unvalidated' },
      portfolio: { source: 'paper_ledger' },
    });
    expect(listDecisionEvidenceEvents(decisionId, PROFILE, db).map((event) => event.kind))
      .toEqual(['strategy_evaluated', 'execution_planned', 'execution_submitted']);

    const orders = listWalletRunAudits(PROFILE, 50, db).find((a) => a.kind === 'execution');
    expect(orders?.status).toBe('submitted');
    db.close();
  });

  it('settles only after the exact next bar completes and never settles twice', () => {
    const db = seeded();
    const first = runPaperDecision(deps(db, new FixedClock(T0 + DAY)), T0 + DAY);
    expect(countPaperFills(PROFILE, 0, db)).toBe(0);

    runPaperDecision(deps(db, new FixedClock(T0 + 2 * DAY), {
      preparation: () => paperPreparation([BTC, ETH], T0 + DAY),
    }), T0 + 2 * DAY);
    const afterSettlement = (db.prepare(`
      SELECT COUNT(*) AS count FROM paper_fills_v3 AS fills
      JOIN paper_orders_v3 AS orders ON orders.id = fills.order_id
      WHERE orders.run_id = ?
    `).get(first.runId) as { count: number }).count;
    expect(afterSettlement).toBeGreaterThan(0);

    runPaperDecision(deps(db, new FixedClock(T0 + 2 * DAY), {
      preparation: () => paperPreparation([BTC, ETH], T0 + DAY),
    }), T0 + 2 * DAY);
    expect((db.prepare(`
      SELECT COUNT(*) AS count FROM paper_fills_v3 AS fills
      JOIN paper_orders_v3 AS orders ON orders.id = fills.order_id
      WHERE orders.run_id = ?
    `).get(first.runId) as { count: number }).count).toBe(afterSettlement);
    expect(listPaperBalances(PROFILE, db).every((balance) => Number(balance.quantity) >= 0)).toBe(true);
    db.close();
  });

  it('keeps an incomplete exact bar pending and expires it when only a later bar exists', () => {
    const incompleteDb = seeded();
    runPaperDecision(deps(incompleteDb, new FixedClock(T0 + DAY)), T0 + DAY);
    const incompleteMarket: PaperMarketData = {
      ...MARKET,
      bars: (key) => bars(30, key).map((bar) => bar.startTimeMs === T0 + DAY
        ? { ...bar, isComplete: false }
        : bar),
    };
    runPaperDecision(deps(incompleteDb, new FixedClock(T0 + 2 * DAY), {
      market: incompleteMarket,
      preparation: () => paperPreparation([BTC, ETH], T0 + DAY),
    }), T0 + 2 * DAY);
    expect((incompleteDb.prepare(`
      SELECT COUNT(*) AS count FROM paper_pending_executions_v1
      WHERE required_bar_start = ? AND status = 'submitted'
    `).get(T0 + DAY) as { count: number }).count).toBeGreaterThan(0);
    incompleteDb.close();

    const missingDb = seeded();
    runPaperDecision(deps(missingDb, new FixedClock(T0 + DAY)), T0 + DAY);
    const missingMarket: PaperMarketData = {
      ...MARKET,
      bars: (key) => bars(30, key).filter((bar) => bar.startTimeMs !== T0 + DAY),
    };
    runPaperDecision(deps(missingDb, new FixedClock(T0 + 2 * DAY), {
      market: missingMarket,
      preparation: () => paperPreparation([BTC, ETH], T0 + DAY),
    }), T0 + 2 * DAY);
    expect((missingDb.prepare(`
      SELECT COUNT(*) AS count FROM paper_pending_executions_v1
      WHERE required_bar_start = ? AND status = 'expired'
    `).get(T0 + DAY) as { count: number }).count).toBeGreaterThan(0);
    missingDb.close();
  });

  it('includes an absent target and funds its opening buy by settling sells first', () => {
    const db = openDatabase(':memory:');
    seedPaperOrigin(db, PROFILE, [holding(BTC_REF, '1100.00', '10')], T0);
    setPaperExecutionPolicy({
      commandId: '00000000-0000-4000-8000-000000000009',
      profileId: PROFILE,
      mode: 'unattended',
      confirmedAt: T0,
      explicitUnattendedConfirmation: true,
    }, db);
    const openingPolicy: AllocationPolicy = {
      targets: [
        { instrument: BTC, weight: 0.85 },
        { instrument: ETH, weight: 0.15 },
      ],
      rebalanceBandPct: 1,
    };
    const shared = {
      policy: () => openingPolicy,
      holdings: () => [holding(BTC_REF, '1100.00', '10')],
    };
    const submitted = runPaperDecision(deps(db, new FixedClock(T0 + DAY), shared), T0 + DAY);
    expect(submitted.submittedCount).toBe(2);
    expect((db.prepare(`SELECT side FROM paper_orders_v3 ORDER BY rowid`).all() as Array<{ side: string }>)
      .map(({ side }) => side)).toEqual(['sell', 'buy']);

    runPaperDecision(deps(db, new FixedClock(T0 + 2 * DAY), {
      ...shared,
      preparation: () => paperPreparation([BTC, ETH], T0 + DAY),
    }), T0 + 2 * DAY);
    const balances = listPaperBalances(PROFILE, db);
    expect(Number(balances.find((balance) => balance.assetId === ETH_KEY)?.quantity ?? '0'))
      .toBeGreaterThan(0);
    expect(Number(balances.find((balance) => balance.assetId === 'USD')?.quantity ?? '0'))
      .toBeGreaterThanOrEqual(0);
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
    // Recognized simulator-pending orders survive restart and are not ambiguous.
    expect(recovered.blocked).toBe(0);
    expect((db.prepare(`
      SELECT COUNT(*) AS count FROM paper_orders_v3 WHERE state = 'submitted'
    `).get() as { count: number }).count).toBeGreaterThan(0);
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
        preparation: () => { throw new Error('market preparation unavailable'); },
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
