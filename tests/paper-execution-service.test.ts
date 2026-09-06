import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  type AssetRef,
  type ExecutionIntent,
  type Holding,
  type MarketBar,
  type ProductRuleSnapshot,
  type UsdAmount,
} from '../packages/core/src/index.js';
import { PaperExecutionService, type PaperExecutionState } from '../packages/services/src/index.js';
import {
  bootstrapPaperBalances,
  getPaperExecutionPolicy,
  openDatabase,
  setPaperExecutionPolicy,
  type Db,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const AT = T0 + DAY;
const PROFILE = 'main';
const BTC = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' } as const;
const BTC_KEY = instrumentKey(BTC);
const ASSET: AssetRef = {
  instrument: BTC, symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC',
  quoteAsset: 'USD', coingeckoId: 'bitcoin',
};
const INTENT: ExecutionIntent = {
  asset: ASSET, side: 'buy', amountUsd: '250.00' as UsdAmount,
  origin: 'rebalance', urgency: 'standard', referencePriceUsd: '111.00' as UsdAmount,
};
const HOLDING: Holding = {
  asset: ASSET, quantity: '1.00000000' as Holding['quantity'],
  avgCostUsd: '100.00' as UsdAmount, priceUsd: '111.00' as UsdAmount,
  valueUsd: '10000.00' as UsdAmount, unrealizedPnlUsd: '0' as UsdAmount,
  unrealizedPnlPct: 0,
};
const RULES: ProductRuleSnapshot = {
  id: 'a'.repeat(64), instrument: BTC, status: 'online', tradingDisabled: false,
  cancelOnly: false, limitOnly: false, postOnly: false, viewOnly: false,
  baseIncrement: '0.00000001', quoteIncrement: '0.01', priceIncrement: '0.01',
  baseMinSize: '0.00000001', baseMaxSize: null, quoteMinSize: '1', quoteMaxSize: null,
  source: 'coinbase', retrievedAt: T0, responseHash: 'b'.repeat(64),
};

function bar(day: number, open: number, close: number): MarketBar {
  return {
    assetId: BTC_KEY, source: 'coinbase', interval: '1d',
    startTimeMs: T0 + day * DAY, endTimeMs: T0 + (day + 1) * DAY,
    open, high: Math.max(open, close), low: Math.min(open, close), close,
    volume: 100, isComplete: true, retrievedAtMs: T0,
  };
}

function seeded(): Db {
  const database = openDatabase(':memory:');
  bootstrapPaperBalances(PROFILE, [{ assetId: 'USD', quantity: '10000' }], 'seed', T0, database);
  return database;
}

function action() {
  return { proposalId: 'proposal-1', runId: 'run-1', revision: 1, intents: [INTENT] } as const;
}

function service(database: Db, state: PaperExecutionState, executionOwnerId?: string) {
  return new PaperExecutionService({
    database,
    profileId: PROFILE,
    nowMs: () => AT,
    market: { bars: () => [bar(0, 100, 110), bar(1, 111, 120)], rules: () => RULES },
    state: () => state,
    ...(executionOwnerId === undefined ? {} : { executionOwnerId }),
  });
}

function readyState(): PaperExecutionState {
  return {
    holdings: [HOLDING], killSwitchEngaged: false, evidenceVerified: true,
    historicalGrossEdgeLowerBoundPct: 12,
  };
}

function approve(target: PaperExecutionService, hash: string, commandId = crypto.randomUUID()) {
  return target.review({
    commandId, proposalId: 'proposal-1', proposalHash: hash,
    decision: 'approve', reviewer: 'owner', note: 'Reviewed gate evidence.',
  });
}

describe('authoritative paper execution service', () => {
  it('defaults existing profiles to review-required and persists nothing before approval', () => {
    const database = seeded();
    expect(getPaperExecutionPolicy(PROFILE, database).mode).toBe('review_required');
    const prepared = service(database, readyState()).prepare(action());
    expect(prepared.status).toBe('pending');
    expect(prepared.reasonCode).toBe('human_review_required');
    expect(database.prepare('SELECT COUNT(*) AS n FROM paper_orders_v3').get()).toEqual({ n: 0 });
    database.close();
  });

  it('runs fresh gates after human review and returns the durable outcome for a duplicate command', () => {
    const database = seeded();
    const target = service(database, readyState());
    const prepared = target.prepare(action());
    const commandId = crypto.randomUUID();
    const first = approve(target, prepared.proposalHash, commandId);
    const duplicate = approve(target, prepared.proposalHash, commandId);
    expect(first.status).toBe('succeeded');
    expect(duplicate).toEqual(first);
    expect(database.prepare('SELECT COUNT(*) AS n FROM paper_fills_v3').get()).toEqual({ n: 1 });
    database.close();
  });

  it('prevents two local hosts from reaching placement for the same run', () => {
    const database = seeded();
    setPaperExecutionPolicy({
      commandId: crypto.randomUUID(), profileId: PROFILE, mode: 'unattended',
      confirmedAt: AT, explicitUnattendedConfirmation: true,
    }, database);
    const first = service(database, readyState(), 'desktop-a').prepare(action());
    const second = service(database, readyState(), 'desktop-b').prepare({
      ...action(), proposalId: 'proposal-2', revision: 2,
    });
    expect(first.status).toBe('succeeded');
    expect(second).toMatchObject({ status: 'blocked', reasonCode: 'execution_lease_unavailable' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM paper_fills_v3').get()).toEqual({ n: 1 });
  });

  it('refuses stale review hashes and a kill switch engaged after preflight', () => {
    const database = seeded();
    let state = readyState();
    const target = new PaperExecutionService({
      database, profileId: PROFILE, nowMs: () => AT,
      market: { bars: () => [bar(0, 100, 110), bar(1, 111, 120)], rules: () => RULES },
      state: () => state,
    });
    const prepared = target.prepare(action());
    expect(approve(target, 'c'.repeat(64)).reasonCode).toBe('stale_proposal_review');
    state = { ...state, killSwitchEngaged: true };
    const blocked = approve(target, prepared.proposalHash);
    expect(blocked).toMatchObject({ status: 'blocked', reasonCode: 'kill_switch_engaged' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM paper_orders_v3').get()).toEqual({ n: 0 });
    database.close();
  });

  it('requires explicit provenance for unattended mode and still uses identical gates', () => {
    const database = seeded();
    expect(() => setPaperExecutionPolicy({
      commandId: crypto.randomUUID(), profileId: PROFILE, mode: 'unattended',
      confirmedAt: AT, explicitUnattendedConfirmation: false,
    }, database)).toThrow('explicit confirmation');
    setPaperExecutionPolicy({
      commandId: crypto.randomUUID(), profileId: PROFILE, mode: 'unattended',
      confirmedAt: AT, explicitUnattendedConfirmation: true,
    }, database);
    const outcome = service(database, readyState()).prepare(action());
    expect(outcome.status).toBe('succeeded');
    const review = database.prepare('SELECT decision, reviewer FROM paper_execution_reviews_v1').get();
    expect(review).toEqual({ decision: 'system_not_required', reviewer: 'explicit unattended policy' });
    database.close();
  });

  it('rolls back every financial row and records unknown after an interrupted transaction', () => {
    const database = seeded();
    database.exec(`
      CREATE TRIGGER injected_fill_failure BEFORE INSERT ON paper_fills_v3
      BEGIN SELECT RAISE(ABORT, 'injected failure'); END;
    `);
    const target = service(database, readyState());
    const prepared = target.prepare(action());
    const outcome = approve(target, prepared.proposalHash);
    expect(outcome).toMatchObject({ status: 'unknown', reasonCode: 'ambiguous_outcome' });
    expect(database.prepare('SELECT COUNT(*) AS n FROM paper_orders_v3').get()).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM paper_fills_v3').get()).toEqual({ n: 0 });
    expect(database.prepare('SELECT COUNT(*) AS n FROM paper_product_rule_snapshots_v3').get())
      .toEqual({ n: 0 });
    expect(database.prepare("SELECT COUNT(*) AS n FROM paper_ledger_entries_v3 WHERE order_id IS NOT NULL").get())
      .toEqual({ n: 0 });
    expect(database.prepare('SELECT status FROM paper_execution_attempts_v1').get())
      .toEqual({ status: 'unknown' });
    database.close();
  });
});
