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
  type ProfileConnectionV2,
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
  listExploratoryPaperBalances,
  listDecisionEvidenceEvents,
  listSubmittedExploratoryPaperExecutions,
  openDatabase,
  saveConnectionAccountSnapshotV2,
  saveProfileConnectionV2,
  saveProviderAccountRef,
  saveUnifiedPortfolioSnapshotV2,
} from '../packages/storage/src/index.js';
import { paperPreparation } from './support.js';

const PROFILE = 'exploratory-profile';
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

function snapshot(connection: ProfileConnectionV2): ConnectionAccountSnapshotV2 {
  const account = providerAccountRefV1(connection, 'account-1', AT);
  const balances = [
    { accountRefId: account.id, exposureKey: assetExposureKey('BTC'),
      instrument: { venue: connection.provider, productId: 'BTC-USD', productType: 'spot' as const },
      availableQuantity: '1', heldQuantity: '0', totalQuantity: '1', priceUsd: '50000', valueUsd: '50000' },
    { accountRefId: account.id, exposureKey: assetExposureKey('DOGE'),
      instrument: { venue: connection.provider, productId: 'DOGE-USD', productType: 'spot' as const },
      availableQuantity: '100', heldQuantity: '0', totalQuantity: '100', priceUsd: '0.1', valueUsd: '10' },
    { accountRefId: account.id, exposureKey: assetExposureKey('USD'), instrument: null,
      availableQuantity: '25', heldQuantity: '0', totalQuantity: '25', priceUsd: '1', valueUsd: '25' },
  ];
  const material = { schemaVersion: 2 as const, profileId: PROFILE, connectionId: connection.id,
    provider: connection.provider, asOfMs: AT, balances, cashUsd: '25', buyingPowerUsd: '25',
    pendingOrderIds: [] as string[], permissions: { accountRead: true, marketRead: true,
      orderRead: true, trade: false as const }, rulesHash: sha256Hex('rules'),
    feeEvidenceHash: sha256Hex('fees'), health: 'healthy' as const, failureReason: null,
    complete: true, provenance: { source: connection.provider, requestedAtMs: AT - 1, receivedAtMs: AT } };
  const contentHash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
  return { ...material, id: sha256Hex(`connection-account-snapshot-v2:${contentHash}`), contentHash };
}

function stubPreparation(assetIds: readonly string[]): PaperDecisionPreparation {
  return { ok: true, datasetHash: sha256Hex('dataset'), latestCompletedStartMs: AT - 86_400_000,
    expectedCompletedStartMs: AT - 86_400_000, ruleSnapshotHash: sha256Hex('rules'),
    dataset: { assets: assetIds } } as unknown as PaperDecisionPreparation;
}

function fixture() {
  const database = openDatabase(':memory:');
  const connection = profileConnectionV2(PROFILE, 'robinhood_crypto', sha256Hex('credential'), AT);
  const source = snapshot(connection);
  saveProfileConnectionV2(connection, database);
  saveProviderAccountRef(providerAccountRefV1(connection, 'account-1', AT), database);
  saveConnectionAccountSnapshotV2(source, database);
  saveUnifiedPortfolioSnapshotV2(buildUnifiedPortfolioSnapshotV2(PROFILE, [source], AT), database);
  return { database, service: new ExploratoryPaperCampaignService(database) };
}

describe('exploratory paper campaign', () => {
  it('copies connected holdings once and preserves unsupported assets as unmanaged', () => {
    const { database, service } = fixture();
    const result = service.start({ profileId: PROFILE, commandId: 'command-1',
      explicitConfirmation: true, nowMs: AT + 1,
      instruments: [{ venue: 'coinbase', productType: 'spot', productId: 'BTC-USD' }],
      preparation: stubPreparation(['coinbase|spot|BTC-USD']) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.campaign.openingCashUsd).toBe('25');
    expect(result.campaign.openingCashProvenance).toBe('connected_snapshot');
    expect(result.campaign.baseWeights).toEqual([{ assetId: 'coinbase|spot|BTC-USD', weight: 1 }]);
    expect(result.campaign.openingBalances).toEqual(expect.arrayContaining([
      expect.objectContaining({ exposureKey: 'BTC', managed: true }),
      expect.objectContaining({ exposureKey: 'DOGE', managed: false, assetId: null }),
    ]));
    expect(listExploratoryPaperBalances(result.campaign.campaignId, PROFILE, database))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ exposureKey: 'USD', quantity: '25' }),
        expect.objectContaining({ exposureKey: 'BTC', quantity: '1', managed: true }),
        expect.objectContaining({ exposureKey: 'DOGE', quantity: '100', managed: false }),
      ]));
    expect(service.start({ profileId: PROFILE, commandId: 'command-1',
      explicitConfirmation: true, nowMs: AT + 2,
      instruments: [{ venue: 'coinbase', productType: 'spot', productId: 'BTC-USD' }],
      preparation: stubPreparation(['coinbase|spot|BTC-USD']) })).toEqual(result);
    expect(() => database.prepare('DELETE FROM exploratory_paper_campaigns_v1').run()).toThrow();
    database.close();
  });

  it('uses the shared strategy, submits without fabricated edge, and settles at the next open', () => {
    const { database } = fixture();
    const service = new ExploratoryPaperCampaignService(database);
    const initialPreparation = paperPreparation([BTC], AT);
    const started = service.start({ profileId: PROFILE,
      commandId: '00000000-0000-4000-8000-000000000077', explicitConfirmation: true,
      preparation: initialPreparation, instruments: [BTC], nowMs: AT });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const market: PaperMarketData = { bars: () => bars(AT), rules: () => RULES };
    const makeDependencies = (clock: FixedClock, currentPreparation: PaperDecisionPreparation) => ({
      database, clock, profileId: PROFILE, market,
      preparation: () => currentPreparation,
      holdings: () => { throw new Error('connected holdings must not drive exploratory planning'); },
      policy: () => ({ rebalanceBandPct: 0, targets: [] }),
      historicalGrossEdgeLowerBoundPct: null,
      evidenceVerified: () => false,
    } satisfies PaperRunLoopDependencies);

    const first = runExploratoryPaperDecision(
      makeDependencies(new FixedClock(AT + DAY + 10 * 60_000), initialPreparation), AT,
    );
    expect(first.strategyVersion).toBe('trendvol-exploratory-paper-v1');
    expect(first.standDown).toBe('pending_settlement');
    expect(first.submittedCount).toBeGreaterThan(0);
    const pending = listSubmittedExploratoryPaperExecutions(
      started.campaign.campaignId, PROFILE, database,
    );
    expect(pending.every((item) => item.requiredExecutionBarStartMs === AT + DAY)).toBe(true);
    const submissionEvents = listDecisionEvidenceEvents(pending[0]!.decisionId, PROFILE, database);
    expect(submissionEvents.map((event) => event.kind)).toContain('execution_submitted');
    const proposed = database.prepare(`SELECT detail_json FROM paper_order_events_v3
      WHERE state='proposed' LIMIT 1`).get() as { detail_json: string };
    expect(JSON.parse(proposed.detail_json)).toMatchObject({
      admissionMode: 'exploratory', campaignId: started.campaign.campaignId,
      profitabilityAssessment: { status: 'unavailable', historicalGrossEdgeLowerBoundPct: null,
        reason: 'no_applicable_validated_edge' },
      evidenceEligibility: { validation: false, promotion: false, liveExecution: false },
    });

    const laterMarket: PaperMarketData = { bars: () => bars(AT + DAY), rules: () => RULES };
    runExploratoryPaperDecision({
      ...makeDependencies(new FixedClock(AT + 2 * DAY + 10 * 60_000), paperPreparation([BTC], AT + DAY)),
      market: laterMarket,
      preparation: () => paperPreparation([BTC], AT + DAY),
    }, AT + DAY);
    expect(listExploratoryPaperBalances(started.campaign.campaignId, PROFILE, database)
      .every((balance) => Number(balance.quantity) >= 0)).toBe(true);
    expect(database.prepare('SELECT COUNT(*) AS count FROM paper_fills_v3').get())
      .toMatchObject({ count: first.submittedCount });
    database.close();
  });

  it('requires confirmation and at least one decision-eligible asset', () => {
    const { database, service } = fixture();
    const base = { profileId: PROFILE, commandId: 'command-2', nowMs: AT + 1,
      instruments: [] as const, preparation: stubPreparation([]) };
    expect(service.start({ ...base, explicitConfirmation: false }))
      .toEqual({ ok: false, code: 'confirmation_required' });
    expect(service.start({ ...base, explicitConfirmation: true }))
      .toEqual({ ok: false, code: 'no_decision_eligible_assets' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM exploratory_paper_campaigns_v1').get())
      .toEqual({ count: 0 });
    database.close();
  });

  it('uses append-only lifecycle events and permits only one active campaign', () => {
    const { database, service } = fixture();
    const start = service.start({ profileId: PROFILE, commandId: 'command-3',
      explicitConfirmation: true, nowMs: AT + 1,
      instruments: [{ venue: 'coinbase', productType: 'spot', productId: 'BTC-USD' }],
      preparation: stubPreparation(['coinbase|spot|BTC-USD']) });
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(service.transition({ profileId: PROFILE, campaignId: start.campaign.campaignId,
      commandId: 'pause', action: 'pause', nowMs: AT + 2 })).toMatchObject({ ok: true,
      value: { status: 'paused' } });
    expect(service.transition({ profileId: PROFILE, campaignId: start.campaign.campaignId,
      commandId: 'resume', action: 'resume', nowMs: AT + 3 })).toMatchObject({ ok: true,
      value: { status: 'active' } });
    expect(database.prepare('SELECT COUNT(*) AS count FROM exploratory_paper_campaign_events_v1').get())
      .toEqual({ count: 3 });
    expect(service.status('different-profile')).toBeNull();
    expect(() => database.prepare(`INSERT INTO exploratory_paper_campaign_state_v1
      (profile_id,campaign_id,status,revision,updated_at) VALUES(?,?,'active',0,?)`)
      .run('different-profile', start.campaign.campaignId, AT + 4)).toThrow('profile mismatch');
    database.close();
  });
});
