import { describe, expect, it } from 'vitest';

import { FixedClock, sha256Hex, trialRegistryHash } from '../packages/core/src/index.js';
import { RiskEvidenceTrackerService } from '../packages/services/src/index.js';
import {
  openDatabase,
  loadTrialRegistry,
  saveResearchPreRegistration,
  saveResearchEvidenceSnapshot,
  setTrialRegistryCompleteness,
  type Db,
  type StoredResearchEvidenceSnapshot,
} from '../packages/storage/src/index.js';

function completeTrialHistory(database: Db): void {
  database.prepare(
    "UPDATE trial_registry_meta SET completeness = 'complete' WHERE singleton = 1",
  ).run();
}

function gateResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'risk_gate_evidence',
    snapshot: {
      dayMs: Date.UTC(2026, 7, 10),
      leader: 'trendvol',
      dsr: 0.96,
      psr: 0.98,
      sigVerdict: 'significant',
      wfVerdict: 'adds_value',
      leaderSortino: 2,
      holdSortino: 1,
      passiveSortino: 1.5,
      sampleDays: 400,
      ...overrides,
    },
  };
}

function evidenceSnapshot(
  result: unknown,
  overrides: Partial<StoredResearchEvidenceSnapshot> = {},
): StoredResearchEvidenceSnapshot {
  const withoutHash = {
    id: overrides.id ?? 'risk-evidence-1',
    createdAtMs: overrides.createdAtMs ?? Date.UTC(2026, 7, 10, 1),
    datasetHash: overrides.datasetHash ?? 'a'.repeat(64),
    trialRegistryHash: overrides.trialRegistryHash ?? 'b'.repeat(64),
    costProfileHash: overrides.costProfileHash ?? 'c'.repeat(64),
    codeRevision: overrides.codeRevision ?? 'revision-secret-value',
    preRegistrationHash: overrides.preRegistrationHash ?? 'd'.repeat(64),
    resultJson: overrides.resultJson ?? JSON.stringify(result),
  };
  return {
    ...withoutHash,
    snapshotHash: overrides.snapshotHash ?? sha256Hex(JSON.stringify(withoutHash)),
  };
}

function saveEvidence(
  database: Db,
  result: unknown,
  overrides: Partial<StoredResearchEvidenceSnapshot> = {},
): StoredResearchEvidenceSnapshot {
  const snapshot = evidenceSnapshot(result, {
    trialRegistryHash: trialRegistryHash(loadTrialRegistry(database)),
    ...overrides,
  });
  saveResearchPreRegistration({
    id: `plan:${snapshot.id}`,
    registeredAt: new Date(Date.UTC(2026, 7, 9)).toISOString(),
    family: 'trendvol',
    candidateCount: 1,
    datasetHash: snapshot.datasetHash,
    costProfileHash: snapshot.costProfileHash,
    codeRevision: snapshot.codeRevision,
    planJson: '{}',
    planHash: snapshot.preRegistrationHash,
  }, database);
  saveResearchEvidenceSnapshot(snapshot, database);
  return snapshot;
}

describe('risk evidence-tracker service', () => {
  it('reports the current incomplete trial-history block without claiming gate figures', () => {
    const database = openDatabase(':memory:');
    const service = new RiskEvidenceTrackerService({
      database,
      clock: new FixedClock(123),
    });
    const first = service.track();
    const second = service.track();

    expect(first).toEqual(second);
    expect(first).toEqual(expect.objectContaining({
      schemaVersion: 1,
      assessedAtMs: 123,
      status: 'blocked_trial_history_incomplete',
      trialHistoryComplete: false,
      source: null,
      facts: null,
      gates: [],
      conversationEligible: false,
      liveExecutionPermitted: false,
      assessmentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.gates)).toBe(true);
    database.close();
  });

  it('distinguishes missing, integrity-failed, and unsupported verified evidence', () => {
    const missingDb = openDatabase(':memory:');
    completeTrialHistory(missingDb);
    expect(new RiskEvidenceTrackerService({
      database: missingDb, clock: new FixedClock(1),
    }).track().status).toBe('blocked_no_verified_evidence');
    missingDb.close();

    const invalidDb = openDatabase(':memory:');
    completeTrialHistory(invalidDb);
    saveEvidence(invalidDb, gateResult(), {
      snapshotHash: '0'.repeat(64),
    });

    const invalid = new RiskEvidenceTrackerService({
      database: invalidDb, clock: new FixedClock(2),
    }).track();
    expect(invalid).toEqual(expect.objectContaining({
      status: 'blocked_invalid_evidence', source: null, facts: null, gates: [],
    }));
    invalidDb.close();

    const mismatchedDb = openDatabase(':memory:');
    completeTrialHistory(mismatchedDb);
    saveEvidence(mismatchedDb, gateResult(), { trialRegistryHash: 'e'.repeat(64) });
    expect(new RiskEvidenceTrackerService({
      database: mismatchedDb, clock: new FixedClock(2),
    }).track().status).toBe('blocked_invalid_evidence');
    mismatchedDb.close();

    const planMismatchDb = openDatabase(':memory:');
    completeTrialHistory(planMismatchDb);
    const planMismatch = evidenceSnapshot(gateResult(), {
      trialRegistryHash: trialRegistryHash(loadTrialRegistry(planMismatchDb)),
    });
    saveResearchPreRegistration({
      id: 'mismatched-plan',
      registeredAt: new Date(Date.UTC(2026, 7, 9)).toISOString(),
      family: 'trendvol',
      candidateCount: 1,
      datasetHash: 'f'.repeat(64),
      costProfileHash: planMismatch.costProfileHash,
      codeRevision: planMismatch.codeRevision,
      planJson: '{}',
      planHash: planMismatch.preRegistrationHash,
    }, planMismatchDb);
    saveResearchEvidenceSnapshot(planMismatch, planMismatchDb);
    expect(new RiskEvidenceTrackerService({
      database: planMismatchDb, clock: new FixedClock(2),
    }).track().status).toBe('blocked_invalid_evidence');
    planMismatchDb.close();

    const unsupportedDb = openDatabase(':memory:');
    completeTrialHistory(unsupportedDb);
    saveEvidence(unsupportedDb, { verdict: 'negative' });
    const unsupported = new RiskEvidenceTrackerService({
      database: unsupportedDb, clock: new FixedClock(3),
    }).track();
    expect(unsupported).toEqual(expect.objectContaining({
      status: 'blocked_unsupported_evidence',
      source: expect.objectContaining({ snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
      facts: null,
      gates: [],
      liveExecutionPermitted: false,
    }));
    unsupportedDb.close();
  });

  it('exposes only strict hash-bound gate facts and permits review, never execution', () => {
    const database = openDatabase(':memory:');
    completeTrialHistory(database);
    const stored = saveEvidence(database, gateResult());
    const before = database.prepare(
      'SELECT COUNT(*) AS count FROM research_evidence_snapshots_v2',
    ).get();
    const result = new RiskEvidenceTrackerService({
      database,
      clock: new FixedClock(Date.UTC(2026, 7, 10, 2)),
    }).track();

    expect(result).toEqual(expect.objectContaining({
      status: 'eligible_for_review',
      trialHistoryComplete: true,
      conversationEligible: true,
      liveExecutionPermitted: false,
      source: {
        createdAtMs: stored.createdAtMs,
        datasetHash: stored.datasetHash,
        trialRegistryHash: stored.trialRegistryHash,
        costProfileHash: stored.costProfileHash,
        preRegistrationHash: stored.preRegistrationHash,
        codeRevisionHash: sha256Hex(stored.codeRevision),
        snapshotHash: stored.snapshotHash,
      },
      facts: expect.objectContaining({
        evidenceDayMs: Date.UTC(2026, 7, 10),
        leader: 'trendvol',
        dsr: 0.96,
        sampleDays: 400,
      }),
      gates: [
        { code: 'significance', met: true },
        { code: 'walk_forward', met: true },
        { code: 'beats_benchmarks', met: true },
        { code: 'sample_size', met: true },
      ],
    }));
    expect(JSON.stringify(result)).not.toContain('revision-secret-value');
    expect(JSON.stringify(result)).not.toContain('unlikely to be');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.source)).toBe(true);
    expect(Object.isFrozen(result.facts)).toBe(true);
    expect(result.gates.every((gate) => Object.isFrozen(gate))).toBe(true);
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM research_evidence_snapshots_v2',
    ).get()).toEqual(before);
    database.close();
  });

  it('reports unmet requirements and rejects contradictory significant evidence', () => {
    const unmetDb = openDatabase(':memory:');
    completeTrialHistory(unmetDb);
    saveEvidence(unmetDb, gateResult({
      dsr: 0.9,
      sigVerdict: 'inconclusive',
      wfVerdict: 'matches_passive',
      leaderSortino: 1,
      holdSortino: 2,
      sampleDays: 100,
    }));
    const unmet = new RiskEvidenceTrackerService({
      database: unmetDb, clock: new FixedClock(4),
    }).track();
    expect(unmet.status).toBe('requirements_not_met');
    expect(unmet.conversationEligible).toBe(false);
    expect(unmet.gates.every((gate) => !gate.met)).toBe(true);
    unmetDb.close();

    const contradictoryDb = openDatabase(':memory:');
    completeTrialHistory(contradictoryDb);
    saveEvidence(contradictoryDb, gateResult({ dsr: 0.9 }));
    expect(new RiskEvidenceTrackerService({
      database: contradictoryDb, clock: new FixedClock(5),
    }).track().status).toBe('blocked_unsupported_evidence');
    contradictoryDb.close();
  });
  it('accepts a conservative upper bound, matching the significance engine', () => {
    const database = openDatabase(':memory:');
    // Over-counting trials deflates further, so an upper bound can only make
    // this gate harder to pass. Core already admits it for DSR; blocking here
    // would let the two disagree about the same registry.
    setTrialRegistryCompleteness('conservative-upper-bound', database);
    const view = new RiskEvidenceTrackerService({
      database,
      clock: new FixedClock(123),
    }).track();

    expect(view.status).not.toBe('blocked_trial_history_incomplete');
    database.close();
  });

  it('still blocks on a known lower bound', () => {
    const database = openDatabase(':memory:');
    const view = new RiskEvidenceTrackerService({
      database,
      clock: new FixedClock(123),
    }).track();

    expect(view.status).toBe('blocked_trial_history_incomplete');
    expect(view.trialHistoryComplete).toBe(false);
    database.close();
  });
});
