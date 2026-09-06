import { describe, expect, it } from 'vitest';

import {
  createCoinbasePaperVenueAdapter,
  createRobinhoodPaperVenueAdapter,
} from '../packages/adapters/src/index.js';
import {
  assetExposureKey,
  createExecutionPlan,
  executionRouteCandidatesHash,
  routeExecutionPlan,
  sha256Hex,
  strategyDecisionId,
  type ExecutionRouteCandidateV1,
  type StrategyDecisionV1,
} from '../packages/core/src/index.js';
import { VenueNeutralPaperRoutingService } from '../packages/services/src/index.js';
import {
  appendDecisionEvidenceEvent,
  getExecutionPlan,
  listExecutionRoutes,
  openDatabase,
  saveStrategyDecision,
} from '../packages/storage/src/index.js';

const PROFILE = 'profile-a';
const AT = 1_725_000_000_000;

function decision(): StrategyDecisionV1 {
  return {
    schemaVersion: 1, decisionId: strategyDecisionId(PROFILE, AT), profileId: PROFILE,
    runId: sha256Hex('routing-run'), scheduledForMs: AT,
    strategy: { id: 'trendvol', version: 'trendvol-paper-v1-unvalidated', configHash: sha256Hex('config') },
    market: {
      snapshotHash: sha256Hex('market'), asOfMs: AT - 1, expectedAsOfMs: AT - 1,
      freshness: 'fresh', refreshResult: 'succeeded', ruleSnapshotHash: sha256Hex('rules'),
      rulesFresh: true,
    },
    portfolio: { snapshotHash: sha256Hex('portfolio'), version: 'unified-v1', source: 'paper_ledger' },
    targets: [], cashWeight: 1, exposure: 0, historyStatus: 'complete', facts: null, createdAtMs: AT,
  };
}

function candidate(input: Partial<ExecutionRouteCandidateV1> & Pick<ExecutionRouteCandidateV1,
  'connectionId' | 'provider' | 'exposureKey' | 'instrument'>): ExecutionRouteCandidateV1 {
  return {
    supported: true, availableCashUsd: '1000', availableAssetValueUsd: '1000',
    feeBps: 10, spreadBps: 5, liquidityUsd: '1000000', minimumOrderUsd: '1',
    permissionMode: 'paper', health: 'healthy', pendingOrderCount: 0,
    assumptionHash: sha256Hex(`assumption:${input.connectionId}`), ...input,
  };
}

describe('venue-neutral execution routing', () => {
  it('routes asset deltas deterministically without letting strategy select a venue', () => {
    const value = decision();
    const candidates = [
      candidate({
        connectionId: 'coinbase-a', provider: 'coinbase', exposureKey: assetExposureKey('BTC'),
        instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' }, feeBps: 12,
      }),
      candidate({
        connectionId: 'robinhood-a', provider: 'robinhood_crypto', exposureKey: assetExposureKey('BTC'),
        instrument: { venue: 'robinhood_crypto', productId: 'BTC-USD', productType: 'spot' }, feeBps: 2,
      }),
      candidate({
        connectionId: 'coinbase-a', provider: 'coinbase', exposureKey: assetExposureKey('ETH'),
        instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
      }),
    ];
    const plan = createExecutionPlan({
      profileId: PROFILE, decisionId: value.decisionId,
      marketSnapshotHash: sha256Hex('market'), portfolioSnapshotHash: sha256Hex('portfolio'),
      strategyConfigHash: sha256Hex('config'), riskAssessmentHash: sha256Hex('risk'),
      permissionSnapshotHash: sha256Hex('permissions'), ruleSnapshotHash: sha256Hex('rules'),
      connectionSetHash: executionRouteCandidatesHash(candidates), costModelHash: sha256Hex('costs'),
      deltas: [
        { exposureKey: assetExposureKey('BTC'), side: 'buy', amountUsd: '100' },
        { exposureKey: assetExposureKey('ETH'), side: 'sell', amountUsd: '50' },
      ],
      createdAtMs: AT,
    });
    const database = openDatabase(':memory:');
    const stored = saveStrategyDecision(value, database);
    appendDecisionEvidenceEvent({
      schemaVersion: 1, decisionId: value.decisionId, profileId: PROFILE, sequence: 0,
      kind: 'strategy_evaluated', atMs: AT, detail: { decisionHash: stored.contentHash },
    }, database);
    appendDecisionEvidenceEvent({
      schemaVersion: 1, decisionId: value.decisionId, profileId: PROFILE, sequence: 1,
      kind: 'execution_planned', atMs: AT,
      detail: { planId: plan.id, planHash: plan.contentHash, intentCount: 2 },
    }, database);
    let changed = false;
    const service = new VenueNeutralPaperRoutingService({
      database,
      adapters: [createCoinbasePaperVenueAdapter(), createRobinhoodPaperVenueAdapter()],
      currentAssumptionHash: (route) => changed ? sha256Hex('changed') : route.assumptionHash,
    });
    const eventId = sha256Hex(`${value.decisionId}:1:execution_planned`);
    const first = service.plan(plan, candidates, eventId);
    const retry = service.plan(plan, [...candidates].reverse(), eventId);
    expect(first).toEqual(retry);
    expect(first.routes.map((route) => [route.exposureKey, route.provider])).toEqual([
      ['ETH', 'coinbase'], ['BTC', 'robinhood_crypto'],
    ]);
    expect(new Set(first.routes.map((route) => route.idempotencyKey)).size).toBe(2);
    expect(getExecutionPlan(plan.id, PROFILE, database)).toEqual(plan);
    expect(listExecutionRoutes(plan.id, 'profile-b', database)).toEqual([]);

    const route = first.routes.find((item) => item.provider === 'robinhood_crypto')!;
    const placed = service.place(PROFILE, plan.id, route.id);
    expect(placed).toMatchObject({ accepted: true, reasonCode: 'accepted' });
    expect(service.place(PROFILE, plan.id, route.id)).toEqual(placed);
    changed = true;
    expect(service.place(PROFILE, plan.id, route.id)).toMatchObject({
      accepted: false, reasonCode: 'assumption_changed', providerOrderId: null,
    });
  });

  it('blocks pending orders and prevents two routes from spending the same connection cash', () => {
    const value = decision();
    const blocked = candidate({
      connectionId: 'coinbase-a', provider: 'coinbase', exposureKey: assetExposureKey('BTC'),
      instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
      pendingOrderCount: 1, availableCashUsd: '100',
    });
    const eligible = [blocked, candidate({
      connectionId: 'coinbase-b', provider: 'coinbase', exposureKey: assetExposureKey('BTC'),
      instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' }, availableCashUsd: '100',
    }), candidate({
      connectionId: 'coinbase-b', provider: 'coinbase', exposureKey: assetExposureKey('ETH'),
      instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' }, availableCashUsd: '100',
    })];
    const plan = createExecutionPlan({
      profileId: PROFILE, decisionId: value.decisionId,
      marketSnapshotHash: sha256Hex('market'), portfolioSnapshotHash: sha256Hex('portfolio'),
      strategyConfigHash: sha256Hex('config'), riskAssessmentHash: sha256Hex('risk'),
      permissionSnapshotHash: sha256Hex('permissions'), ruleSnapshotHash: sha256Hex('rules'),
      connectionSetHash: executionRouteCandidatesHash(eligible), costModelHash: sha256Hex('costs'),
      deltas: [
        { exposureKey: assetExposureKey('BTC'), side: 'buy', amountUsd: '60' },
        { exposureKey: assetExposureKey('ETH'), side: 'buy', amountUsd: '60' },
      ], createdAtMs: AT,
    });
    const database = openDatabase(':memory:');
    saveStrategyDecision(value, database);
    const service = new VenueNeutralPaperRoutingService({
      database, adapters: [createCoinbasePaperVenueAdapter()],
      currentAssumptionHash: (route) => route.assumptionHash,
    });
    const result = service.plan(plan, eligible);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({ exposureKey: 'BTC', connectionId: 'coinbase-b' });
    expect(result.unrouteable).toEqual([expect.objectContaining({ exposureKey: 'ETH' })]);
  });

  it('enforces capability, permission, health, liquidity, minimum, and balance constraints', () => {
    const value = decision();
    const base = {
      connectionId: 'connection', provider: 'coinbase' as const,
      exposureKey: assetExposureKey('BTC'),
      instrument: { venue: 'coinbase' as const, productId: 'BTC-USD', productType: 'spot' as const },
    };
    const candidates = [
      candidate({ ...base, connectionId: 'unsupported', supported: false }),
      candidate({ ...base, connectionId: 'permission', permissionMode: 'view_only' }),
      candidate({ ...base, connectionId: 'health', health: 'degraded' }),
      candidate({ ...base, connectionId: 'liquidity', liquidityUsd: '99' }),
      candidate({ ...base, connectionId: 'minimum', minimumOrderUsd: '101' }),
      candidate({ ...base, connectionId: 'balance', availableCashUsd: '99' }),
    ];
    const plan = createExecutionPlan({
      profileId: PROFILE, decisionId: value.decisionId,
      marketSnapshotHash: sha256Hex('market'), portfolioSnapshotHash: sha256Hex('portfolio'),
      strategyConfigHash: sha256Hex('config'), riskAssessmentHash: sha256Hex('risk'),
      permissionSnapshotHash: sha256Hex('permissions'), ruleSnapshotHash: sha256Hex('rules'),
      connectionSetHash: executionRouteCandidatesHash(candidates), costModelHash: sha256Hex('costs'),
      deltas: [{ exposureKey: assetExposureKey('BTC'), side: 'buy', amountUsd: '100' }],
      createdAtMs: AT,
    });
    expect(routeExecutionPlan(plan, candidates)).toEqual({ routes: [], unrouteable: plan.deltas });
    expect(() => routeExecutionPlan(plan, [{ ...candidates[0]!, assumptionHash: sha256Hex('new') }]))
      .toThrow('connection binding');
  });
});
