import { describe, expect, it } from 'vitest';

import {
  deriveForwardCounterfactual,
  evaluateForwardEdgeResult,
  forwardEdgeDeflatedSharpeProbability,
  forwardEdgeLowerConfidenceBoundPct,
  materializeForwardEdgeResult,
  scoreForwardEdgeEvent,
  type ForwardEdgeStudyResult,
} from '../packages/core/src/index.js';
import {
  appendPaperCampaignEvent,
  activateProfitabilityEstimate,
  ensurePaperCampaign,
  listForwardEdgeObservations,
  openDatabase,
  readPaperCampaign,
  readProfitabilityEstimateEvidence,
  recordForwardEdgeStudyResult,
  registerForwardEdgeStudy,
  saveForwardEdgeObservation,
} from '../packages/storage/src/index.js';
import { SHIPPED_FORWARD_EDGE_PLAN } from '../apps/desktop/src/main/forward-edge-plan.js';

const SOURCE = 'a'.repeat(64);

function passing(planHash: string): ForwardEdgeStudyResult {
  return evaluateForwardEdgeResult({
    planHash,
    completedDays: 365,
    costBearingRebalances: 30,
    completeValuations: true,
    grossEdgeLowerConfidenceBoundPct: 3,
    netEdgeLowerConfidenceBoundPct: 1,
    excessVsHoldPct: 2,
    excessVsPassivePct: 1,
    deflatedSharpeProbability: 0.95,
    maximumDrawdownPct: 35,
    sourceHashes: [SOURCE],
  });
}

describe('prospective edge scoring', () => {
  it('values the no-trade counterfactual from the exact pre-decision state', () => {
    expect(deriveForwardCounterfactual({
      preDecisionBalances: [
        { assetId: 'USD', quantity: '50.125' },
        { assetId: 'coinbase|spot|BTC-USD', quantity: '0.25' },
      ],
      valuedPositions: [{ productId: 'BTC-USD', quantity: '0.5', valueUsd: '15000' }],
      fills: [{ notionalUsd: '100', venueFeeUsd: '0.4', spreadUsd: '0.1',
        slippageUsd: '0.2', impactUsd: '0.05' }],
    })).toEqual({
      noTradeEndingEquityUsd: '7550.125',
      turnoverUsd: '100',
      recordedCostUsd: '0.75',
    });
  });

  it('subtracts recorded execution costs exactly once', () => {
    expect(scoreForwardEdgeEvent({
      atMs: 1, turnoverUsd: '100', actualEndingEquityUsd: '109',
      noTradeEndingEquityUsd: '100', recordedCostUsd: '4',
      valuationComplete: true, stateHash: SOURCE,
    })).toEqual({ grossEdgePct: '13', costPct: '4', netEdgePct: '9' });
  });

  it('rejects incomplete valuations and incomplete samples', () => {
    expect(scoreForwardEdgeEvent({
      atMs: 1, turnoverUsd: '100', actualEndingEquityUsd: '109',
      noTradeEndingEquityUsd: '100', recordedCostUsd: '4',
      valuationComplete: false, stateHash: SOURCE,
    })).toBeNull();
    expect(evaluateForwardEdgeResult({ ...passing(SOURCE), completedDays: 364 }).outcome)
      .toBe('incomplete');
  });

  it('requires every registered adoption threshold', () => {
    expect(passing(SOURCE).outcome).toBe('passed');
    expect(evaluateForwardEdgeResult({
      ...passing(SOURCE), netEdgeLowerConfidenceBoundPct: 0,
    }).outcome).toBe('failed');
    expect(evaluateForwardEdgeResult({
      ...passing(SOURCE), deflatedSharpeProbability: 0.949,
    }).outcome).toBe('failed');
    expect(evaluateForwardEdgeResult({
      ...passing(SOURCE), maximumDrawdownPct: 35.01,
    }).outcome).toBe('failed');
  });

  it('uses deterministic block bootstrap and the registered trial upper bound', () => {
    const edges = Array.from({ length: 40 }, (_, index) => 1 + (index % 3) / 10);
    expect(forwardEdgeLowerConfidenceBoundPct(edges, 42))
      .toBe(forwardEdgeLowerConfidenceBoundPct(edges, 42));
    const dsr = forwardEdgeDeflatedSharpeProbability(
      Array.from({ length: 365 }, (_, index) => 0.002 + (index % 5) * 0.0001),
      [0.01, 0.02, 0.03],
    );
    expect(dsr).not.toBeNull();
    expect(dsr).toBeGreaterThanOrEqual(0);
    expect(dsr).toBeLessThanOrEqual(1);
  });

  it('finishes a full zero-volatility sample as failed instead of waiting forever', () => {
    const observations = Array.from({ length: 365 }, (_, index) => ({
      dayUtc: index * 86_400_000,
      actualEquityUsd: '100', holdEquityUsd: '100', noTradeEquityUsd: '100',
      turnoverUsd: index < 30 ? '100' : '0', recordedCostUsd: '0',
      marketPrices: { 'BTC-USD': '100', 'ETH-USD': '50', 'LTC-USD': '10' },
      valuationComplete: true, evidenceHash: SOURCE,
    }));
    expect(materializeForwardEdgeResult({
      planHash: SOURCE, observations, observedTrialSharpes: [0.1, 0.2], bootstrapSeed: 49,
    }).outcome).toBe('failed');
  });
});

describe('migration 49 evidence authority', () => {
  it('keeps plans immutable and ignores the predecessor manual setting', () => {
    const db = openDatabase(':memory:');
    const planHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, db);
    db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('paper.net_edge_estimate_pct', '99')").run();
    expect(readProfitabilityEstimateEvidence('main', db)).toBeNull();
    expect(() => db.prepare('UPDATE forward_edge_study_plans_v1 SET code_revision = ? WHERE plan_hash = ?')
      .run('tampered', planHash)).toThrow('immutable');
    db.close();
  });

  it('activates only an integrity-verified passing result and remains profile scoped', () => {
    const db = openDatabase(':memory:');
    const planHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, db);
    const resultHash = recordForwardEdgeStudyResult(passing(planHash), 2_000_000_000_000, true, db);
    activateProfitabilityEstimate({ profileId: 'alpha', resultHash, commandId: 'activate-1',
      activatedAt: 2_000_000_000_001 }, db);
    expect(readProfitabilityEstimateEvidence('alpha', db)?.grossEdgeLowerBoundPct).toBe(3);
    expect(readProfitabilityEstimateEvidence('beta', db)).toBeNull();
    expect(() => activateProfitabilityEstimate({ profileId: 'beta', resultHash,
      commandId: 'activate-1', activatedAt: 2_000_000_000_002 }, db))
      .toThrow('command_conflict');
    db.close();
  });

  it('refuses failed or integrity-unverified results', () => {
    const db = openDatabase(':memory:');
    const planHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, db);
    const resultHash = recordForwardEdgeStudyResult(passing(planHash), 2_000_000_000_000, false, db);
    expect(() => activateProfitabilityEstimate({ profileId: 'main', resultHash,
      commandId: 'activate-2', activatedAt: 2_000_000_000_001 }, db))
      .toThrow('not_eligible');
    db.close();
  });
});

describe('migration 50 prospective observations and campaign evidence', () => {
  it('keeps one immutable observation per real profile day', () => {
    const db = openDatabase(':memory:');
    const planHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, db);
    const observation = {
      id: 'observation-1', planHash, profileId: 'main', dayUtc: 1_728_000_000_000,
      runId: 'run-1', observedAt: 1_728_000_000_100,
      actualEquityUsd: '100', holdEquityUsd: '100', noTradeEquityUsd: '100',
      turnoverUsd: '0', recordedCostUsd: '0',
      marketPricesJson: JSON.stringify({ 'BTC-USD': '1', 'ETH-USD': '1', 'LTC-USD': '1' }),
      valuationComplete: true, stateHash: SOURCE, provenanceJson: '{}',
      evidenceHash: 'b'.repeat(64),
    };
    expect(saveForwardEdgeObservation(observation, db)).toBe(true);
    expect(saveForwardEdgeObservation(observation, db)).toBe(false);
    expect(listForwardEdgeObservations(planHash, 'main', db)).toHaveLength(1);
    expect(() => saveForwardEdgeObservation({ ...observation, turnoverUsd: '1' }, db))
      .toThrow('cannot be replaced');
    db.close();
  });

  it('completes only after seven observed UTC days, a kill-switch exercise and reconciliation', () => {
    const db = openDatabase(':memory:');
    const start = 1_728_000_000_000;
    const campaign = ensurePaperCampaign({ profileId: 'main', kind: 'zero_edge_stand_down',
      startDayUtc: start, registeredAt: start }, db);
    for (let day = 0; day < 7; day += 1) appendPaperCampaignEvent({
      campaignId: campaign.id, dayUtc: start + day * 86_400_000, runId: `run-${day}`,
      status: 'observed', at: start + day * 86_400_000, detail: {},
    }, db);
    expect(readPaperCampaign(campaign.id, db)?.state).toBe('running');
    appendPaperCampaignEvent({ campaignId: campaign.id, dayUtc: start, runId: 'kill-switch',
      status: 'kill_switch_exercised', at: start, detail: {} }, db);
    appendPaperCampaignEvent({ campaignId: campaign.id, dayUtc: start, runId: 'acknowledgement',
      status: 'kill_switch_acknowledged', at: start, detail: {} }, db);
    appendPaperCampaignEvent({ campaignId: campaign.id, dayUtc: start, runId: 'reconciliation',
      status: 'reconciled', at: start, detail: {} }, db);
    expect(readPaperCampaign(campaign.id, db)).toMatchObject({
      observedDays: 7, killSwitchExercised: true, killSwitchAcknowledged: true,
      reconciled: true, state: 'completed',
    });
    db.close();
  });
});
