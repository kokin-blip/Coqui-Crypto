import { afterEach, describe, expect, it } from 'vitest';
import { capitalHash, cashClaim, decimal, instrumentKey, nativeExecutionRules, type AssetRef, type ExecutionIntent, type Holding,
  strategyDecisionId, FixedClock, createExecutionPlan, executionRouteCandidatesHash, assetExposureKey,
  type ExecutionRouteCandidateV1, type MarketBar, type ProductRuleSnapshot } from '@coqui/core';
import { createPaperCapitalBudgetPort, ingestLocalPaperCapital, capitalScopesView, runExecutionGates, isApproved,
  paperCostModelHash, PaperExecutionService, previewCapitalSimulation, VenueNeutralPaperRoutingService,
  capitalRouteCandidates } from '@coqui/services';
import { PaperOmsService } from '../packages/services/src/paper/oms.js';
import { initializePaperBook, listCashClaims, listPaperBalances, openDatabase, saveCashClaim,
  saveCapitalBinding, saveStrategyDecision, acquireExecutionLease, type Db } from '@coqui/storage';
import { ASSET, NOW, feasibility, rules } from './helpers/feasibility.js';
import { capturePaperPerformanceEvidence } from '../apps/desktop/src/main/paper-performance-evidence.js';

const instrument = { venue: 'coinbase', productType: 'spot', productId: 'BTC-USD' } as const;
const asset: AssetRef = { instrument, symbol: 'BTC', baseAsset: 'BTC', quoteAsset: 'USD', name: 'Bitcoin', coingeckoId: 'bitcoin' };
const holding: Holding = { asset, quantity: decimal('100'), avgCostUsd: decimal('100'), priceUsd: decimal('100'), valueUsd: decimal('10000'), unrealizedPnlUsd: null, unrealizedPnlPct: null };
const legacyRules: ProductRuleSnapshot = { id: capitalHash('legacy-rules'), instrument, status: 'online', tradingDisabled: false,
  cancelOnly: false, limitOnly: false, postOnly: false, viewOnly: false, baseIncrement: '0.00000001', baseMinSize: '0.00000001',
  baseMaxSize: null, quoteIncrement: '0.01', quoteMinSize: '1', quoteMaxSize: null, priceIncrement: '0.01',
  source: 'coinbase', retrievedAt: NOW, responseHash: capitalHash('fixture') };
const bar = (start: number): MarketBar => ({ assetId: instrumentKey(instrument), source: 'coinbase', interval: '1d', startTimeMs: start,
  endTimeMs: start + 1000, open: 100, high: 100, low: 100, close: 100, volume: 1000, isComplete: true, retrievedAtMs: start });
const intent = (side: 'buy' | 'sell', amount: string): ExecutionIntent => ({ asset, side, amountUsd: decimal(amount), origin: 'rebalance', urgency: 'standard', referencePriceUsd: decimal('100') });
function approve(side: 'buy' | 'sell', amount: string, runId: string, now: number) {
  const approval = runExecutionGates({ profileId: 'main', runId, nowMs: now, mode: 'paper', killSwitchEngaged: false,
    intents: [intent(side, amount)], holdings: [holding], historicalGrossEdgeLowerBoundPct: 12 });
  if (!isApproved(approval)) throw new Error(`fixture_gate:${approval.code}`); return approval;
}
const dbs: Db[] = []; afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
async function setup() {
  const db = openDatabase(':memory:'); dbs.push(db); let now = NOW, authority = true;
  initializePaperBook({ schemaVersion: 1, profileId: 'main', source: 'tracked_holdings_opening', asOfMs: NOW - 1000,
    cashUsd: '0', balances: [{ assetId: ASSET, quantity: '2', priceUsd: '100', valueUsd: '200' }] }, db);
  const market = { rules: () => legacyRules, bars: () => [bar(NOW - 1000), bar(NOW), bar(NOW + 2000)] };
  expect(new PaperOmsService({ database: db, clock: { nowMs: () => now }, market }).execute(approve('sell', '200', 'opening-sale', now)).filledCount).toBe(1);
  now = NOW + 2000;
  await capturePaperPerformanceEvidence({ profileId: 'main', runId: 'budget-mark', scheduledForMs: now, database: db,
    clock: new FixedClock(now), priceSource: { name: 'fixture', spot: async () => new Map([[instrumentKey(instrument), {
      priceUsd: decimal('100'), source: 'fixture', quality: 'venue_reported_last' as const, observedAtMs: now }]]) } });
  ingestLocalPaperCapital('main', db, now, { evidenceHash: capitalHash('quotes'), observations: new Map([[ASSET, {
    priceUsd: decimal('100'), source: 'fixture', quality: 'venue_reported_last', observedAtMs: now }]]) });
  const scopeId = capitalScopesView('main', db).scopes[0]!.scope.id;
  const port = createPaperCapitalBudgetPort({ profileId: 'main', scopeId, database: db, now: () => now, guardAuthority: () => authority });
  const errors: unknown[] = [];
  const oms = new PaperOmsService({ database: db, clock: { nowMs: () => now }, market, capitalBudget: port, onUnexpectedError: (_, error) => errors.push(String(error)) });
  const hold = (amount: string) => saveCashClaim(cashClaim({ scopeId, originKey: `foreign:${amount}`, replacesId: null, assetId: 'USD',
    amount, purpose: 'order', state: 'unknown', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['other_existing_intent'] }), db);
  let decisionIndex = 0;
  const decision = () => {
    const at = now + decisionIndex++, decisionId = strategyDecisionId('main', at), hash = capitalHash('fixture');
    saveStrategyDecision({ schemaVersion: 1, decisionId, profileId: 'main', runId: capitalHash({ at }), scheduledForMs: at,
      strategy: { id: 'trendvol', version: 'trendvol-paper-v1-unvalidated', configHash: hash }, market: { snapshotHash: hash,
        asOfMs: at - 1, expectedAsOfMs: at - 1, freshness: 'fresh', refreshResult: 'succeeded', ruleSnapshotHash: hash, rulesFresh: true },
      portfolio: { snapshotHash: hash, version: 'unified-v1', source: 'paper_ledger' }, targets: [], cashWeight: 1,
      exposure: 0, historyStatus: 'complete', facts: null, createdAtMs: at }, db); return decisionId;
  };
  return { db, scopeId, port, oms, market, hold, errors, decision, now: () => now, setNow: (at: number) => { now = at; }, revoke: () => { authority = false; } };
}

describe('P2 actual simulator consumer boundaries (explicit isolated injection only)', () => {
  it('reduces an immediate fill to shared free cash instead of spending another intent’s commitment', async () => {
    const f = await setup(), before = Number(f.port.budget().observedCashUsd); f.hold('150');
    const free = Number(f.port.budget().spendableUsd);
    const result = f.oms.execute(approve('buy', '70', 'protected-buy', f.now()));
    expect(result.filledCount).toBe(1); expect(f.errors).toEqual([]);
    const after = Number(listPaperBalances('main', f.db).find(row => row.assetId === 'USD')?.quantity);
    expect(before - after).toBeLessThanOrEqual(free); expect(before - after).toBeLessThan(70);
  });
  it('commits and settles immediate claims atomically with actual ledger debits', async () => {
    const f = await setup(), cash = Number(f.port.budget().observedCashUsd);
    expect(f.oms.execute(approve('buy', '30', 'small-buy', f.now())).filledCount).toBe(1);
    expect(Number(f.port.budget().observedCashUsd)).toBeLessThan(cash - 30);
    expect(listCashClaims(f.scopeId, f.db).at(-1)?.state).toBe('settled');
    expect(f.port.budget().spendableUsd).toBe(f.port.budget().observedCashUsd);
  });
  it('does not turn unexplained manual cash activity into supported local buying capacity', async () => {
    const f = await setup(), prior = Number(f.port.budget().observedCashUsd);
    f.db.prepare("INSERT INTO paper_ledger_entries_v3 VALUES('unexplained-cash','main','manual',NULL,NULL,'cash',NULL,'100','0',?)").run(f.now());
    f.db.prepare("UPDATE paper_balances_v3 SET quantity_text=? WHERE profile_id='main' AND asset_id='USD'").run(String(prior + 100));
    const report = f.port.budget(); expect(report.observedCashUsd).toBe(String(prior + 100));
    expect(report.reasonCodes).toContain('paper_funding_or_ledger_provenance_unknown'); expect(report.spendableUsd).toBeNull();
    expect(f.oms.execute(approve('buy', '70', 'unexplained-buy', f.now())).filledCount).toBe(0);
  });
  it('rejects an actual pricing-to-commit race and rolls back a failed fill together with its claim', async () => {
    const f = await setup(), before = listPaperBalances('main', f.db);
    let raced = false;
    const racedRules = { ...legacyRules, get baseIncrement() { if (!raced) { raced = true; f.hold('150'); } return legacyRules.baseIncrement; } };
    const racing = new PaperOmsService({ database: f.db, clock: { nowMs: f.now }, capitalBudget: f.port,
      market: { ...f.market, rules: () => racedRules } });
    expect(racing.execute(approve('buy', '70', 'race', f.now())).filledCount).toBe(0);
    expect(listPaperBalances('main', f.db)).toEqual(before); expect(listCashClaims(f.scopeId, f.db)).toHaveLength(1);
    f.db.exec("CREATE TRIGGER p2_injected_fill_failure BEFORE INSERT ON paper_fills_v3 BEGIN SELECT RAISE(ABORT,'injected_fill_failure'); END");
    const revision = f.port.budget().revision;
    expect(f.oms.execute(approve('buy', '30', 'crash', f.now())).filledCount).toBe(0);
    expect(f.port.budget().revision).toBe(revision); expect(listCashClaims(f.scopeId, f.db)).toHaveLength(1);
    expect(listPaperBalances('main', f.db)).toEqual(before);
  });
  it('retains pending commitments, rejects a competing order, and consumes its own claim once', async () => {
    const f = await setup(); const context = { decisionId: f.decision(), requiredExecutionBarStartMs: NOW + 4000, costModelHash: paperCostModelHash() };
    const pending = f.oms.submitPending(approve('buy', '150', 'pending-a', f.now()), context);
    expect(f.errors).toEqual([]); expect(pending.submittedCount).toBe(1); expect(Number(f.port.budget().spendableUsd)).toBeLessThan(50);
    expect(f.oms.submitPending(approve('buy', '70', 'pending-b', f.now()), { ...context, decisionId: f.decision() }).submittedCount).toBe(0);
    f.setNow(NOW + 400_000);
    const settling = new PaperOmsService({ database: f.db, clock: { nowMs: f.now }, capitalBudget: f.port,
      market: { ...f.market, bars: () => [bar(NOW + 4000)] } });
    expect(settling.settlePending('main').filledCount).toBe(1);
    expect(f.port.budget().spendableUsd).toBe(f.port.budget().observedCashUsd);
    expect(settling.settlePending('main').filledCount).toBe(0);
  });
  it('releases only after a real terminal expiry; authority loss or archived bindings fail closed', async () => {
    const f = await setup();
    const pending = f.oms.submitPending(approve('buy', '30', 'expires', f.now()), { decisionId: f.decision(),
      requiredExecutionBarStartMs: NOW + 4000, costModelHash: paperCostModelHash() });
    expect(() => f.port.releaseTerminal(pending.orderIds[0]!)).toThrow('not_terminal');
    f.setNow(NOW + 400_000);
    const expired = new PaperOmsService({ database: f.db, clock: { nowMs: f.now }, capitalBudget: f.port,
      market: { ...f.market, bars: () => [bar(NOW + 6000)] } });
    expect(expired.settlePending('main').expiredCount).toBe(1);
    expect(listCashClaims(f.scopeId, f.db).at(-1)?.state).toBe('released');
    f.revoke(); expect(() => f.port.budget()).toThrow('authority');
    saveCapitalBinding({ profileId: 'main', scopeId: f.scopeId, connectionId: null, mode: 'archived', lastBatchId: null }, f.db);
    expect(() => f.port.budget()).toThrow('authority');
  });
  it('binds an actual PaperExecutionService preview to budget/model evidence and rejects an old review', async () => {
    const f = await setup(), frame = feasibility('200');
    const model = { assets: () => [{ assetId: ASSET, markUsd: '100', quote: { bid: '100', ask: '100', atMs: f.now() },
      rules: nativeExecutionRules({ ...rules, observedAtMs: f.now(), expiresAtMs: f.now() + 30_000 }) }],
      fees: () => frame.fees, policy: () => frame.policy };
    const service = new PaperExecutionService({ database: f.db, profileId: 'main', nowMs: f.now, market: f.market,
      state: () => ({ holdings: [holding], killSwitchEngaged: false, evidenceVerified: true, historicalGrossEdgeLowerBoundPct: 12 }),
      capitalBudget: f.port, capitalPreviewModel: model });
    const prepared = service.prepare({ proposalId: 'p2-preview', runId: 'p2-review-run', revision: 1, intents: [intent('buy', '30')] });
    expect(prepared.status).toBe('pending');
    const preview = service.preview('p2-preview'), capital = service.capitalPreview('p2-preview');
    expect(capital.inputManifest.proposal?.id).toBe('p2-preview'); expect(capital.reasonCodes).toEqual([]); expect(capital.state).toBe('feasible');
    f.hold('150');
    expect(service.review({ commandId: 'old-review', proposalId: 'p2-preview', proposalHash: prepared.proposalHash,
      decision: 'approve', previewHash: preview.previewHash, previewExpiresAtMs: preview.expiresAtMs, reviewer: 'fixture', note: '' }).status).toBe('blocked');
    const fresh = service.preview('p2-preview');
    expect(service.review({ commandId: 'fresh-review', proposalId: 'p2-preview', proposalHash: prepared.proposalHash,
      decision: 'approve', previewHash: fresh.previewHash, previewExpiresAtMs: fresh.expiresAtMs, reviewer: 'fixture', note: '' }).filledCount).toBe(1);
  });
  it('keeps new simulation books independent and does not run or register frozen arms', () => {
    const frame = feasibility('100');
    const small = previewCapitalSimulation({ ...frame, scopeId: capitalHash('small'), bookId: 'small', cashUsd: '50', quantities: {}, claims: [] });
    const large = previewCapitalSimulation({ ...frame, scopeId: capitalHash('large'), bookId: 'large', cashUsd: '500', quantities: {}, claims: [] });
    expect(small.budget.observedCashUsd).toBe('50'); expect(large.budget.observedCashUsd).toBe('500');
    expect(small.budget.revision).not.toBe(large.budget.revision); expect(small.report.executionEligible).toBe(false);
    expect(instrumentKey(instrument)).toBe(ASSET);
  });
  it('binds the actual routing service to one cash pool, persists its revision and rejects stale placement before its adapter', async () => {
    const f = await setup(), budget = f.port.budget(), hash = capitalHash('route-source');
    const candidates: ExecutionRouteCandidateV1[] = ['BTC', 'ETH'].map((symbol, index) => ({ connectionId: `local-${index}`, provider: 'coinbase',
      exposureKey: assetExposureKey(symbol), instrument: { ...instrument, productId: `${symbol}-USD` }, supported: true,
      availableCashUsd: '1000000', availableAssetValueUsd: '0', feeBps: 10, spreadBps: 5, liquidityUsd: '1000000',
      minimumOrderUsd: '1', permissionMode: 'paper', health: 'healthy', pendingOrderCount: 0, assumptionHash: hash }));
    const bound = capitalRouteCandidates(candidates, budget, { [ASSET]: '100' });
    expect(bound.candidates.every(row => row.availableCashUsd === budget.spendableUsd)).toBe(true);
    const makePlan = (rows = bound.candidates) => createExecutionPlan({ profileId: 'main', decisionId: f.decision(), marketSnapshotHash: hash,
      portfolioSnapshotHash: budget.id, strategyConfigHash: hash, riskAssessmentHash: hash, permissionSnapshotHash: hash,
      ruleSnapshotHash: hash, connectionSetHash: executionRouteCandidatesHash(rows), costModelHash: hash,
      deltas: ['BTC', 'ETH'].map(symbol => ({ exposureKey: assetExposureKey(symbol), side: 'buy' as const, amountUsd: '150' })), createdAtMs: f.now() });
    let placements = 0;
    const lease = acquireExecutionLease('main', 'p2-routing-test', f.now(), 60_000, f.db)!;
    const service = new VenueNeutralPaperRoutingService({ database: f.db, capitalBudget: f.port, ownerId: 'p2-routing-test',
      nowMs: f.now, fencingToken: () => lease.fencingToken, currentAssumptionHash: route => route.assumptionHash,
      adapters: [{ provider: 'coinbase', place: route => { placements++; return { accepted: true, providerOrderId: route.id,
        reasonCode: 'accepted', idempotencyKey: route.idempotencyKey }; } }] });
    const planned = service.plan(makePlan(), bound.candidates, undefined, bound);
    expect(planned.routes).toHaveLength(1); expect(planned.unrouteable).toHaveLength(1);
    const route = planned.routes[0]!;
    f.hold('1');
    expect(service.place('main', route.planId, route.id).accepted).toBe(false); expect(placements).toBe(0);
    const fresh = f.port.budget();
    const rebound = capitalRouteCandidates(candidates, fresh, { [ASSET]: '100' });
    const second = service.plan(makePlan(rebound.candidates), rebound.candidates, undefined, rebound).routes[0]!;
    expect(service.place('main', second.planId, second.id).accepted).toBe(true); expect(placements).toBe(1);
    expect(Number(f.port.budget().spendableUsd)).toBeLessThan(50);
    expect(service.place('main', second.planId, second.id).accepted).toBe(false); expect(placements).toBe(1);
  });
});
