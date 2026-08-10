import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRADE_COST_CONFIG,
  gridCandidateCount,
  registeredTrialCount,
  researchPreRegistrationHash,
  tradeCostConfigHash,
  totalRegisteredTrialCount,
  trialCountForSignificance,
  type ResearchPreRegistration,
  type TrialRecord,
} from '../packages/core/src/index.js';
import {
  createResearchEvidenceSnapshot,
  registerResearchPreRegistration,
  seedPredecessorTrialAudit,
  verifiedResearchEvidenceSnapshots,
} from '../packages/services/src/index.js';
import {
  appendTrialRecord,
  loadTrialRegistry,
  openDatabase,
} from '../packages/storage/src/index.js';

function verifiedRecord(): TrialRecord {
  return {
    id: 'coqui-cost-correct-research',
    family: 'trendvol',
    searchKind: 'grid',
    evidenceStatus: 'verified',
    parameterSpace: { cadence: [14], lookbackDays: [90, 180] },
    trialCount: 2,
    searchedAt: '2026-08-04T20:00:00.000Z',
    datasetHash: 'c'.repeat(64),
    costProfileHash: 'd'.repeat(64),
    codeRevision: 'research-test-revision',
    producedDefaults: { cadence: 14, lookbackDays: 180 },
    studyRef: 'docs/studies/test-research.md',
  };
}

function preRegistration(
  overrides: Partial<ResearchPreRegistration> = {},
): ResearchPreRegistration {
  const parameterSpace = overrides.parameterSpace ?? { lookbackDays: [90, 180], targetVolPct: [50] };
  return {
    schemaVersion: 1,
    id: 'cost-correct-trendvol-v1',
    registeredAt: '2026-08-04T00:00:00.000Z',
    family: 'trendvol',
    hypothesis: 'Trend plus volatility targeting beats hold and passive after shared costs.',
    parameterSpace,
    candidateCount: gridCandidateCount(parameterSpace),
    datasetHash: 'e'.repeat(64),
    costProfileHash: tradeCostConfigHash(DEFAULT_TRADE_COST_CONFIG),
    codeRevision: 'test-revision',
    execution: {
      baseTargets: [
        { assetId: 'coinbase|spot|BTC-USD', weight: 0.5 },
        { assetId: 'coinbase|spot|ETH-USD', weight: 0.5 },
      ],
      warmupBars: 200,
      cashAprPct: 0,
    },
    validation: {
      development: {
        startMs: Date.UTC(2021, 0, 1),
        endExclusiveMs: Date.UTC(2025, 0, 1),
      },
      holdout: {
        startMs: Date.UTC(2025, 0, 1),
        endExclusiveMs: Date.UTC(2026, 0, 1),
      },
      nestedFoldCount: 5,
      embargoDays: 10,
      minimumDevelopmentBars: 1_000,
      minimumHoldoutBars: 300,
      cscvPartitionCount: 16,
      bootstrapResamples: 5_000,
      bootstrapMeanBlockLength: 20,
      bootstrapConfidenceLevel: 0.95,
      bootstrapSeed: 20_260_809,
    },
    primaryMetric: 'after-cost-excess-return-vs-hold',
    adoptionRules: {
      minimumDeflatedSharpeProbability: 0.95,
      requirePositiveExcessReturnVsHold: true,
      requirePositiveExcessReturnVsPassive: true,
      rejectIfSignificanceUnavailable: true,
      maximumDrawdownPct: 35,
      maximumProbabilityOfBacktestOverfitting: 0.05,
    },
    studyRef: 'docs/studies/cost-correct-preregistration-2026-08-09.md',
    ...overrides,
  };
}

describe('persistent P3 trial registry', () => {
  it('seeds the code-visible predecessor lower bound without double-counting', () => {
    const database = openDatabase(':memory:');
    expect(seedPredecessorTrialAudit(database)).toBe(13);
    expect(seedPredecessorTrialAudit(database)).toBe(0);
    const registry = loadTrialRegistry(database);
    expect(registry.completeness).toBe('known-lower-bound');
    expect(registeredTrialCount(registry, 'momentum')).toBe(23);
    expect(registeredTrialCount(registry, 'voltarget')).toBe(21);
    expect(registeredTrialCount(registry, 'trendvol')).toBe(107);
    expect(registeredTrialCount(registry, 'rotation')).toBe(27);
    expect(totalRegisteredTrialCount(registry)).toBe(178);
    expect(trialCountForSignificance(registry)).toBeNull();
    database.close();
  });

  it('enforces append-only records in SQLite as well as the service API', () => {
    const database = openDatabase(':memory:');
    appendTrialRecord(verifiedRecord(), database);
    expect(loadTrialRegistry(database).records).toHaveLength(1);
    expect(() => appendTrialRecord(verifiedRecord(), database)).toThrow(/already exists/u);
    expect(() => database.prepare(
      "UPDATE trial_registry_records SET trial_count = 3 WHERE id = ?",
    ).run(verifiedRecord().id)).toThrow(/append-only/u);
    expect(() => database.prepare(
      'DELETE FROM trial_registry_records WHERE id = ?',
    ).run(verifiedRecord().id)).toThrow(/append-only/u);
    database.close();
  });

  it('blocks citable evidence while the historical count is only a lower bound', () => {
    const database = openDatabase(':memory:');
    seedPredecessorTrialAudit(database);
    const preRegistrationHash = registerResearchPreRegistration(preRegistration(), database);
    expect(() => createResearchEvidenceSnapshot({
      id: 'blocked-evidence',
      createdAtMs: Date.UTC(2026, 7, 4),
      datasetHash: 'e'.repeat(64),
      codeRevision: 'test-revision',
      preRegistrationHash,
      tradeCosts: DEFAULT_TRADE_COST_CONFIG,
      result: { verdict: 'negative' },
    }, database)).toThrow(/historical trial audit is complete/u);
    database.close();
  });

  it('persists immutable evidence only with a complete registry and cost hash', () => {
    const database = openDatabase(':memory:');
    database.prepare(
      "UPDATE trial_registry_meta SET completeness = 'complete' WHERE singleton = 1",
    ).run();
    appendTrialRecord(verifiedRecord(), database);
    const preRegistrationHash = registerResearchPreRegistration(preRegistration(), database);
    const snapshot = createResearchEvidenceSnapshot({
      id: 'verified-evidence',
      createdAtMs: Date.UTC(2026, 7, 4),
      datasetHash: 'e'.repeat(64),
      codeRevision: 'test-revision',
      preRegistrationHash,
      tradeCosts: DEFAULT_TRADE_COST_CONFIG,
      result: { verdict: 'negative', metrics: { dsr: 0.41 } },
    }, database);
    expect(snapshot.costProfileHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifiedResearchEvidenceSnapshots(database)).toEqual([snapshot]);
    expect(() => database.prepare(
      "UPDATE research_evidence_snapshots_v2 SET result_json = '{}' WHERE id = ?",
    ).run(snapshot.id)).toThrow(/immutable/u);
    expect(() => createResearchEvidenceSnapshot({
      id: snapshot.id,
      createdAtMs: snapshot.createdAtMs,
      datasetHash: snapshot.datasetHash,
      codeRevision: snapshot.codeRevision,
      preRegistrationHash,
      tradeCosts: DEFAULT_TRADE_COST_CONFIG,
      result: { verdict: 'negative' },
    }, database)).toThrow();
    database.close();
  });

  it('binds evidence to the exact pre-registered dataset, costs, and code', () => {
    const database = openDatabase(':memory:');
    const plan = preRegistration();
    const planHash = registerResearchPreRegistration(plan, database);
    expect(planHash).toBe(researchPreRegistrationHash(plan));
    expect(() => createResearchEvidenceSnapshot({
      id: 'predated-evidence',
      createdAtMs: Date.UTC(2026, 7, 3),
      datasetHash: plan.datasetHash,
      codeRevision: plan.codeRevision,
      preRegistrationHash: planHash,
      tradeCosts: DEFAULT_TRADE_COST_CONFIG,
      result: { verdict: 'negative' },
    }, database)).toThrow(/cannot predate/u);
    expect(() => createResearchEvidenceSnapshot({
      id: 'mismatched-evidence',
      createdAtMs: Date.UTC(2026, 7, 9),
      datasetHash: 'f'.repeat(64),
      codeRevision: plan.codeRevision,
      preRegistrationHash: planHash,
      tradeCosts: DEFAULT_TRADE_COST_CONFIG,
      result: { verdict: 'positive' },
    }, database)).toThrow(/does not match/u);
    database.close();
  });
});
