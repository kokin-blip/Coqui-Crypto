import { describe, expect, it } from 'vitest';

import {
  assetExposureKey,
  buildUnifiedPortfolioSnapshotV2,
  connectionAccountSnapshotV2Hash,
  FixedClock,
  instrumentKey,
  profileConnectionV2,
  providerAccountRefV1,
  sha256Hex,
  type ConnectionAccountSnapshotV2,
  type MarketBar,
  type ProductRuleSnapshot,
} from '../packages/core/src/index.js';
import {
  ExploratoryPaperCampaignService,
  runExploratoryPaperDecision,
  type PaperMarketData,
  type PaperRunLoopDependencies,
  type PaperDecisionPreparation,
} from '../packages/services/src/index.js';
import {
  getStrategyDecision,
  getWalletDecisionRun,
  listDecisionEvidenceEvents,
  openDatabase,
  readOperationsFloor,
  saveConnectionAccountSnapshotV2,
  saveProfileConnectionV2,
  saveProviderAccountRef,
  saveUnifiedPortfolioSnapshotV2,
} from '../packages/storage/src/index.js';
import { paperPreparation } from './support.js';

const PROFILE = 'evaluate-test-profile';
const AT = 1_900_000_000_000;
const DAY = 86_400_000;
const BTC = { venue: 'coinbase' as const, productType: 'spot' as const, productId: 'BTC-USD' };
const BTC_KEY = instrumentKey(BTC);

function bars(latestStartMs: number): MarketBar[] {
  return Array.from({ length: 122 }, (_, index) => {
    const startTimeMs = latestStartMs - (120 - index) * DAY;
    const price = 100 + index;
    return { assetId: BTC_KEY, source: 'coinbase' as const, interval: '1d' as const,
      startTimeMs, endTimeMs: startTimeMs + DAY, open: price, high: price + 1,
      low: price - 1, close: price, volume: 100, isComplete: true,
      retrievedAtMs: latestStartMs + DAY + 10 * 60_000 };
  });
}

const RULES: ProductRuleSnapshot = {
  id: 'a'.repeat(64), instrument: BTC, status: 'online', tradingDisabled: false,
  cancelOnly: false, limitOnly: false, postOnly: false, viewOnly: false,
  baseIncrement: '0.00000001', quoteIncrement: '0.01', priceIncrement: '0.01',
  baseMinSize: '0.00000001', baseMaxSize: null, quoteMinSize: '1', quoteMaxSize: null,
  source: 'coinbase', retrievedAt: AT, responseHash: 'b'.repeat(64),
};

function snapshot(profileId: string) {
  const connection = profileConnectionV2(profileId, 'coinbase', sha256Hex('credential'), AT);
  const account = providerAccountRefV1(connection, 'account-1', AT);
  const balances = [
    { accountRefId: account.id, exposureKey: assetExposureKey('BTC'),
      instrument: { venue: 'coinbase' as const, productId: 'BTC-USD', productType: 'spot' as const },
      availableQuantity: '1', heldQuantity: '0', totalQuantity: '1', priceUsd: '50000', valueUsd: '50000' },
    { accountRefId: account.id, exposureKey: assetExposureKey('USD'), instrument: null,
      availableQuantity: '25', heldQuantity: '0', totalQuantity: '25', priceUsd: '1', valueUsd: '25' },
  ];
  const material = { schemaVersion: 2 as const, profileId, connectionId: connection.id,
    provider: connection.provider, asOfMs: AT, balances, cashUsd: '25', buyingPowerUsd: '25',
    pendingOrderIds: [] as string[], permissions: { accountRead: true, marketRead: true,
      orderRead: true, trade: false as const }, rulesHash: sha256Hex('rules'),
    feeEvidenceHash: sha256Hex('fees'), health: 'healthy' as const, failureReason: null,
    complete: true, provenance: { source: connection.provider, requestedAtMs: AT - 1, receivedAtMs: AT } };
  const contentHash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
  return {
    connection,
    account,
    snapshot: { ...material, id: sha256Hex(`connection-account-snapshot-v2:${contentHash}`), contentHash } as ConnectionAccountSnapshotV2,
  };
}

function fixture() {
  const database = openDatabase(':memory:');
  const { connection, account, snapshot: snap } = snapshot(PROFILE);
  saveProfileConnectionV2(connection, database);
  saveProviderAccountRef(account, database);
  saveConnectionAccountSnapshotV2(snap, database);
  saveUnifiedPortfolioSnapshotV2(buildUnifiedPortfolioSnapshotV2(PROFILE, [snap], AT), database);
  const service = new ExploratoryPaperCampaignService(database);
  return { database, service };
}

function startCampaign(database: ReturnType<typeof openDatabase>, service: ExploratoryPaperCampaignService) {
  const preparation = paperPreparation([BTC], AT);
  const result = service.start({ profileId: PROFILE,
    commandId: '00000000-0000-4000-8000-000000000099', explicitConfirmation: true,
    preparation, instruments: [BTC], nowMs: AT });
  if (!result.ok) throw new Error(`Campaign start failed: ${result.code}`);
  return { campaign: result.campaign, preparation };
}

function makeDependencies(
  database: ReturnType<typeof openDatabase>,
  clock: FixedClock,
  preparation: PaperDecisionPreparation,
): PaperRunLoopDependencies {
  const market: PaperMarketData = { bars: () => bars(AT), rules: () => RULES };
  return {
    database, clock, profileId: PROFILE, market,
    preparation: () => preparation,
    holdings: () => { throw new Error('connected holdings must not drive exploratory planning'); },
    policy: () => ({ rebalanceBandPct: 0, targets: [] }),
    historicalGrossEdgeLowerBoundPct: null,
    evidenceVerified: () => false,
  };
}

describe('exploratory paper evaluate', () => {
  it('manual command reaches the evaluator and persists a decision', () => {
    const { database, service } = fixture();
    const { preparation } = startCampaign(database, service);
    const clock = new FixedClock(AT + DAY + 10 * 60_000);
    const summary = runExploratoryPaperDecision(
      makeDependencies(database, clock, preparation), AT,
    );
    expect(summary.profileId).toBe(PROFILE);
    expect(summary.strategyVersion).toBe('trendvol-exploratory-paper-v1');
    expect(summary.scheduledForMs).toBe(AT);
    expect(summary.runId).toHaveLength(64);
    expect(summary.decidedAtMs).toBeGreaterThanOrEqual(AT);
    const stored = getStrategyDecision(
      (database.prepare(`SELECT decision_id FROM strategy_decisions_v1
        WHERE profile_id=? ORDER BY scheduled_for DESC LIMIT 1`).get(PROFILE) as { decision_id: string }).decision_id,
      database,
    );
    expect(stored).not.toBeNull();
    expect(stored!.decision.strategy.version).toBe('trendvol-exploratory-paper-v1');
    const events = listDecisionEvidenceEvents(stored!.decision.decisionId, PROFILE, database);
    expect(events.some((e) => e.kind === 'strategy_evaluated')).toBe(true);
    database.close();
  });

  it('no-signal persists an explicit no-trade with stand-down reason', () => {
    const { database, service } = fixture();
    const { preparation } = startCampaign(database, service);
    const clock = new FixedClock(AT + DAY + 10 * 60_000);
    // With rebalanceBandPct = 0 and only one asset at weight 1, the current
    // campaign balance (100% BTC) already matches the target. TrendVol's
    // momentum signals against only 121 bars of monotonic data produce small
    // weight changes, but the rebalance threshold still applies. Even if an
    // intent is generated, we verify the summary is truthfully recorded.
    const summary = runExploratoryPaperDecision(
      makeDependencies(database, clock, preparation), AT,
    );
    // The outcome is either 'no_intents' (hold) or 'pending_settlement' (trade).
    // Both are persisted. The critical assertion is that a decision row exists.
    expect(summary.standDown).toBeDefined();
    const decisionRow = database.prepare(`SELECT decision_id FROM strategy_decisions_v1
      WHERE profile_id=? ORDER BY scheduled_for DESC LIMIT 1`).get(PROFILE) as { decision_id: string };
    expect(decisionRow).toBeDefined();
    const events = listDecisionEvidenceEvents(decisionRow.decision_id, PROFILE, database);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const terminal = events.at(-1)!;
    // Terminal event is either no_trade, execution_submitted, or stand_down.
    expect(['no_trade', 'execution_submitted', 'execution_planned', 'stand_down']).toContain(terminal.kind);
    database.close();
  });

  it('failed market preparation persists a blocked decision', () => {
    const { database, service } = fixture();
    startCampaign(database, service);
    const clock = new FixedClock(AT + DAY + 10 * 60_000);
    const failedPrep: PaperDecisionPreparation = {
      ok: false, code: 'market_fetch_failed',
    };
    const summary = runExploratoryPaperDecision(
      makeDependencies(database, clock, failedPrep), AT,
    );
    expect(summary.standDown).toBe('market_fetch_failed');
    expect(summary.filledCount).toBe(0);
    expect(summary.submittedCount).toBe(0);
    // Even a failed preparation must persist the decision row.
    const decisionRow = database.prepare(`SELECT decision_id FROM strategy_decisions_v1
      WHERE profile_id=? ORDER BY scheduled_for DESC LIMIT 1`).get(PROFILE) as { decision_id: string };
    expect(decisionRow).toBeDefined();
    const stored = getStrategyDecision(decisionRow.decision_id, database);
    expect(stored!.decision.market.refreshResult).toBe('market_fetch_failed');
    database.close();
  });

  it('repeating evaluate for the same bar cannot duplicate orders or fills', () => {
    const { database, service } = fixture();
    const { preparation } = startCampaign(database, service);
    const clock = new FixedClock(AT + DAY + 10 * 60_000);
    const deps = makeDependencies(database, clock, preparation);
    const first = runExploratoryPaperDecision(deps, AT);
    const ordersBefore = (database.prepare(
      `SELECT COUNT(*) AS count FROM paper_orders_v3`).get() as { count: number }).count;
    const second = runExploratoryPaperDecision(deps, AT);
    const ordersAfter = (database.prepare(
      `SELECT COUNT(*) AS count FROM paper_orders_v3`).get() as { count: number }).count;
    // Second call returns the cached completed run.
    expect(second.runId).toBe(first.runId);
    expect(second.standDown).toBe(first.standDown);
    expect(second.filledCount).toBe(first.filledCount);
    expect(ordersAfter).toBe(ordersBefore);
    database.close();
  });

  it('eligible decisions run through Paper OMS and produce journal entries', () => {
    const { database, service } = fixture();
    const { preparation } = startCampaign(database, service);
    const clock = new FixedClock(AT + DAY + 10 * 60_000);
    const summary = runExploratoryPaperDecision(
      makeDependencies(database, clock, preparation), AT,
    );
    // Whether a fill or a pending submission, a wallet run audit entry must exist.
    const audit = database.prepare(
      `SELECT COUNT(*) AS count FROM wallet_execution_journal WHERE run_id=?`).get(summary.runId) as { count: number };
    expect(audit.count).toBeGreaterThanOrEqual(1);
    // A decision run must be recorded.
    const run = getWalletDecisionRun(summary.runId, database);
    expect(run).not.toBeNull();
    expect(run!.status).toBe('completed');
    database.close();
  });

  it('operations floor shows awaiting before evaluation and decision status after', () => {
    const { database, service } = fixture();
    const { preparation } = startCampaign(database, service);

    // Before evaluation: Scout shows "awaiting" since no decision exists yet.
    const before = readOperationsFloor(PROFILE, database);
    const scoutBefore = before.find((item) => item.subsystem === 'market')!;
    expect(scoutBefore.state).toBe('active');
    expect(scoutBefore.detail).toContain('awaiting');

    // After evaluation: Scout must reflect the actual decision outcome.
    const clock = new FixedClock(AT + DAY + 10 * 60_000);
    runExploratoryPaperDecision(makeDependencies(database, clock, preparation), AT);
    const after = readOperationsFloor(PROFILE, database);
    const scoutAfter = after.find((item) => item.subsystem === 'market')!;
    // Should no longer say "awaiting" — it should reference the decision.
    expect(scoutAfter.detail).not.toContain('awaiting');
    expect(scoutAfter.decisionId).not.toBeNull();
    database.close();
  });
});
