import { describe, expect, it } from 'vitest';
import { FixedClock, firstAttainableDailyOpen, instrumentKey, strategyDecisionId, sha256Hex, type AssetRef, type ExecutionIntent, type Holding,
  type MarketBar, type ProductRuleSnapshot } from '../packages/core/src/index.js';
import { isApproved, runExecutionGates, paperCostModelHash } from '../packages/services/src/index.js';
import { PaperOmsService } from '../packages/services/src/paper/oms.js';
import { bootstrapPaperBalances, listSubmittedPaperExecutions, openDatabase, saveStrategyDecision,
  getPaperOrder, savePaperOrder, savePaperPendingExecution, appendPaperOrderEvent } from '../packages/storage/src/index.js';

const DAY = 86_400_000, START = Date.UTC(2026, 0, 1), OPEN = START + 2 * DAY;
const instrument = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' } as const;
const key = instrumentKey(instrument);
const asset: AssetRef = { instrument, symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD', coingeckoId: null };
const rules: ProductRuleSnapshot = {
  id: 'a'.repeat(64), instrument, status: 'online', tradingDisabled: false, cancelOnly: false,
  limitOnly: false, postOnly: false, viewOnly: false, baseIncrement: '0.00000001', quoteIncrement: '0.01',
  priceIncrement: '0.01', baseMinSize: '0.00000001', baseMaxSize: null, quoteMinSize: '1', quoteMaxSize: null,
  source: 'coinbase', retrievedAt: START, responseHash: 'b'.repeat(64),
};
function fixture(atMs = OPEN - DAY + 600000) {
  const database = openDatabase(':memory:'), clock = new FixedClock(atMs);
  bootstrapPaperBalances('main', [{ assetId: 'USD', quantity: '10000' }], 'synthetic', START, database);
  const decisionId = strategyDecisionId('main', atMs);
  saveStrategyDecision({ schemaVersion: 1, decisionId, profileId: 'main', runId: sha256Hex('timing-test'),
    scheduledForMs: atMs, strategy: { id: 'trendvol', version: 'synthetic', configHash: sha256Hex('config') },
    market: { snapshotHash: null, asOfMs: null, expectedAsOfMs: null, freshness: 'unavailable',
      refreshResult: 'not_requested', ruleSnapshotHash: null, rulesFresh: false },
    portfolio: { snapshotHash: null, version: null, source: 'unavailable' }, targets: [], cashWeight: 1,
    exposure: 0, historyStatus: 'unavailable', facts: null, createdAtMs: atMs }, database);
  const outcome = runExecutionGates({ profileId: 'main', runId: 'timing-test', nowMs: atMs,
    mode: 'paper', killSwitchEngaged: false, historicalGrossEdgeLowerBoundPct: 12,
    intents: [{ asset, side: 'buy', amountUsd: '250', origin: 'rebalance', urgency: 'standard' } as ExecutionIntent],
    holdings: [{ asset, quantity: '1', avgCostUsd: '100', priceUsd: '100', valueUsd: '10000',
      unrealizedPnlUsd: '0', unrealizedPnlPct: 0 } as Holding] });
  if (!isApproved(outcome)) throw new Error('Synthetic fixture must pass gates');
  const bar: MarketBar = { assetId: key, source: 'coinbase', interval: '1d', startTimeMs: OPEN,
    endTimeMs: OPEN + DAY, open: 100, high: 110, low: 90, close: 105,
    volume: 1000, isComplete: true, retrievedAtMs: OPEN + DAY + 300000 };
  const errors: unknown[] = [];
  const oms = new PaperOmsService({ database, clock, market: { bars: () => [bar], rules: () => rules },
    onUnexpectedError: (_product, error) => errors.push(error) });
  const context = { decisionId, requiredExecutionBarStartMs: OPEN, costModelHash: paperCostModelHash() };
  return { database, clock, oms, approval: outcome, context, errors };
}
describe('paper orders require attainable openings', () => {
  it('selects the first future opening after a delayed decision or missed scheduler days', () => {
    expect(firstAttainableDailyOpen(START, START + DAY)).toBe(OPEN);
    expect(firstAttainableDailyOpen(START, START + DAY + 600000)).toBe(OPEN);
    expect(firstAttainableDailyOpen(START, START + 4 * DAY + 600000)).toBe(START + 5 * DAY);
  });
  it.each([OPEN, OPEN + 1])('refuses a new submission at or after its opening (%s)', (at) => {
    const f = fixture(at);
    try {
      expect(f.oms.submitPending(f.approval, f.context)).toMatchObject({ submittedCount: 0, refusedCount: 1 });
      expect(listSubmittedPaperExecutions('main', f.database)).toHaveLength(0);
    } finally { f.database.close(); }
  });
  it('waits for actual bar completion and publication even if a supplied future bar is marked complete', () => {
    const f = fixture();
    try {
      const result = f.oms.submitPending(f.approval, f.context);
      expect(f.errors).toEqual([]);
      expect(result.submittedCount).toBe(1);
      expect(f.oms.settlePending('main')).toMatchObject({ filledCount: 0, pendingCount: 1 });
      f.clock.set(OPEN + DAY + 299999);
      expect(f.oms.settlePending('main')).toMatchObject({ filledCount: 0, pendingCount: 1 });
      f.clock.set(OPEN + DAY + 300000);
      expect(f.oms.settlePending('main')).toMatchObject({ filledCount: 1, pendingCount: 0 });
      expect(f.oms.settlePending('main').filledCount).toBe(0);
    } finally { f.database.close(); }
  });
  it('can retrieve an already-submitted order after its opening without creating another one', () => {
    const f = fixture();
    try {
      const first = f.oms.submitPending(f.approval, f.context);
      f.clock.set(OPEN + 1);
      expect(f.oms.submitPending(f.approval, f.context)).toEqual(first);
      expect(listSubmittedPaperExecutions('main', f.database)).toHaveLength(1);
    } finally { f.database.close(); }
  });
  it('expires a legacy pending order whose recorded submission missed its opening', () => {
    const f = fixture();
    try {
      f.oms.submitPending(f.approval, f.context);
      const prior = listSubmittedPaperExecutions('main', f.database)[0]!;
      const original = getPaperOrder(prior.orderId, f.database)!;
      const legacy = { ...original, id: sha256Hex('legacy-late-order'), runId: sha256Hex('legacy-run'),
        createdAt: OPEN + 1, updatedAt: OPEN + 1 };
      for (const [sequence, state] of (['proposed', 'risk_approved', 'submission_pending', 'submitted'] as const).entries()) {
        savePaperOrder({ ...legacy, state }, f.database);
        appendPaperOrderEvent({ id: `${legacy.id}:${sequence}`, orderId: legacy.id, profileId: 'main',
          sequence, state, at: legacy.createdAt, detailJson: '{"paperOnly":true}' }, f.database);
      }
      savePaperPendingExecution({ ...prior, id: sha256Hex('legacy-late-pending'), orderId: legacy.id,
        submittedAtMs: OPEN + 1 }, f.database);
      f.clock.set(OPEN + DAY + 300000);
      expect(f.oms.settlePending('main')).toMatchObject({ filledCount: 1, expiredCount: 1 });
      expect(getPaperOrder(legacy.id, f.database)).toMatchObject({ state: 'expired', reason: 'execution_open_not_attainable' });
    } finally { f.database.close(); }
  });
});
