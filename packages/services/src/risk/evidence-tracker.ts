import {
  evidenceGateChecklist,
  sha256Hex,
  trialRegistryHash,
  type Clock,
  type EvidenceSnapshot,
} from '@coqui/core';
import {
  findResearchPreRegistrationByHash,
  loadTrialRegistry,
  type Db,
  type StoredResearchEvidenceSnapshot,
} from '@coqui/storage';

import { verifiedResearchEvidenceSnapshots } from '../research/evidence.js';
import { freezeRiskValue } from './immutable.js';

const HASH = /^[a-f0-9]{64}$/u;
const STABLE_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
const DAY_MS = 86_400_000;
const SNAPSHOT_KEYS = [
  'dayMs', 'leader', 'dsr', 'psr', 'sigVerdict', 'wfVerdict', 'leaderSortino',
  'holdSortino', 'passiveSortino', 'sampleDays',
] as const;

export type RiskEvidenceTrackerStatus =
  | 'blocked_trial_history_incomplete'
  | 'blocked_no_verified_evidence'
  | 'blocked_invalid_evidence'
  | 'blocked_unsupported_evidence'
  | 'requirements_not_met'
  | 'eligible_for_review';

export interface RiskEvidenceProvenance {
  readonly createdAtMs: number;
  readonly datasetHash: string;
  readonly trialRegistryHash: string;
  readonly costProfileHash: string;
  readonly preRegistrationHash: string;
  readonly codeRevisionHash: string;
  readonly snapshotHash: string;
}

export interface RiskEvidenceFacts {
  readonly evidenceDayMs: number;
  readonly leader: string;
  readonly dsr: number | null;
  readonly psr: number | null;
  readonly significanceVerdict: EvidenceSnapshot['sigVerdict'];
  readonly walkForwardVerdict: EvidenceSnapshot['wfVerdict'];
  readonly leaderSortino: number | null;
  readonly holdSortino: number | null;
  readonly passiveSortino: number | null;
  readonly sampleDays: number;
}

export interface RiskEvidenceGate {
  readonly code: 'significance' | 'walk_forward' | 'beats_benchmarks' | 'sample_size';
  readonly met: boolean;
}

export interface RiskEvidenceTrackerView {
  readonly schemaVersion: 1;
  readonly assessedAtMs: number;
  readonly status: RiskEvidenceTrackerStatus;
  readonly trialHistoryComplete: boolean;
  readonly source: RiskEvidenceProvenance | null;
  readonly facts: RiskEvidenceFacts | null;
  readonly gates: readonly RiskEvidenceGate[];
  readonly conversationEligible: boolean;
  readonly liveExecutionPermitted: false;
  readonly assessmentHash: string;
}

export interface RiskEvidenceTrackerDependencies {
  readonly database: Db;
  readonly clock: Clock;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    [...expected].sort().every((key, index) => actual[index] === key);
}

function nullableProbability(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function nullableFinite(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000
    ? value
    : undefined;
}

function parseEvidence(resultJson: string): EvidenceSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson);
  } catch {
    return null;
  }
  const envelope = object(parsed);
  if (!envelope || !exactKeys(envelope, ['schemaVersion', 'kind', 'snapshot']) ||
      envelope['schemaVersion'] !== 1 || envelope['kind'] !== 'risk_gate_evidence') return null;
  const snapshot = object(envelope['snapshot']);
  if (!snapshot || !exactKeys(snapshot, SNAPSHOT_KEYS)) return null;

  const dayMs = snapshot['dayMs'];
  const leader = snapshot['leader'];
  const dsr = nullableProbability(snapshot['dsr']);
  const psr = nullableProbability(snapshot['psr']);
  const sigVerdict = snapshot['sigVerdict'];
  const wfVerdict = snapshot['wfVerdict'];
  const leaderSortino = nullableFinite(snapshot['leaderSortino']);
  const holdSortino = nullableFinite(snapshot['holdSortino']);
  const passiveSortino = nullableFinite(snapshot['passiveSortino']);
  const sampleDays = snapshot['sampleDays'];
  const validSig = sigVerdict === 'significant' || sigVerdict === 'inconclusive' ||
    sigVerdict === 'no_edge' || sigVerdict === 'insufficient_data';
  const validWf = wfVerdict === 'adds_value' || wfVerdict === 'matches_passive' ||
    wfVerdict === 'lags_passive' || wfVerdict === 'insufficient_data';
  if (!Number.isSafeInteger(dayMs) || (dayMs as number) < 0 || (dayMs as number) % DAY_MS !== 0 ||
      typeof leader !== 'string' || !STABLE_ID.test(leader) || dsr === undefined ||
      psr === undefined || !validSig || !validWf || leaderSortino === undefined ||
      holdSortino === undefined || passiveSortino === undefined ||
      !Number.isSafeInteger(sampleDays) || (sampleDays as number) < 0 ||
      (sampleDays as number) > 10_000_000 ||
      (sigVerdict === 'significant' && (dsr === null || dsr < 0.95))) return null;
  return {
    dayMs: dayMs as number,
    leader,
    dsr,
    psr,
    sigVerdict,
    wfVerdict,
    leaderSortino,
    holdSortino,
    passiveSortino,
    sampleDays: sampleDays as number,
  };
}

function provenance(snapshot: StoredResearchEvidenceSnapshot): RiskEvidenceProvenance | null {
  if (!Number.isSafeInteger(snapshot.createdAtMs) || snapshot.createdAtMs < 0 ||
      !HASH.test(snapshot.datasetHash) || !HASH.test(snapshot.trialRegistryHash) ||
      !HASH.test(snapshot.costProfileHash) || !HASH.test(snapshot.preRegistrationHash) ||
      !HASH.test(snapshot.snapshotHash) || snapshot.codeRevision.length === 0 ||
      snapshot.codeRevision.length > 200) return null;
  return {
    createdAtMs: snapshot.createdAtMs,
    datasetHash: snapshot.datasetHash,
    trialRegistryHash: snapshot.trialRegistryHash,
    costProfileHash: snapshot.costProfileHash,
    preRegistrationHash: snapshot.preRegistrationHash,
    codeRevisionHash: sha256Hex(snapshot.codeRevision),
    snapshotHash: snapshot.snapshotHash,
  };
}

function finalize(
  view: Omit<RiskEvidenceTrackerView, 'assessmentHash'>,
): RiskEvidenceTrackerView {
  return freezeRiskValue({ ...view, assessmentHash: sha256Hex(JSON.stringify(view)) });
}

function blocked(
  assessedAtMs: number,
  status: Exclude<RiskEvidenceTrackerStatus, 'requirements_not_met' | 'eligible_for_review'>,
  trialHistoryComplete: boolean,
  source: RiskEvidenceProvenance | null = null,
): RiskEvidenceTrackerView {
  return finalize({
    schemaVersion: 1,
    assessedAtMs,
    status,
    trialHistoryComplete,
    source,
    facts: null,
    gates: [],
    conversationEligible: false,
    liveExecutionPermitted: false,
  });
}

/** Read-only LIVE-gate evidence tracker. It can permit review, never execution. */
export class RiskEvidenceTrackerService {
  readonly #database: Db;
  readonly #clock: Clock;

  constructor(dependencies: RiskEvidenceTrackerDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
  }

  track(): RiskEvidenceTrackerView {
    const assessedAtMs = this.#clock.nowMs();
    if (!Number.isSafeInteger(assessedAtMs) || assessedAtMs < 0) {
      throw new RangeError('Risk clock must return a non-negative safe epoch millisecond.');
    }
    let currentTrialRegistryHash: string;
    try {
      const registry = loadTrialRegistry(this.#database);
      if (registry.completeness !== 'complete') {
        return blocked(assessedAtMs, 'blocked_trial_history_incomplete', false);
      }
      currentTrialRegistryHash = trialRegistryHash(registry);
    } catch {
      return blocked(assessedAtMs, 'blocked_invalid_evidence', false);
    }

    let snapshots: readonly StoredResearchEvidenceSnapshot[];
    try {
      snapshots = verifiedResearchEvidenceSnapshots(this.#database);
    } catch {
      return blocked(assessedAtMs, 'blocked_invalid_evidence', true);
    }
    const latest = snapshots.at(-1);
    if (!latest) return blocked(assessedAtMs, 'blocked_no_verified_evidence', true);
    const source = provenance(latest);
    if (!source || source.trialRegistryHash !== currentTrialRegistryHash) {
      return blocked(assessedAtMs, 'blocked_invalid_evidence', true);
    }
    const plan = findResearchPreRegistrationByHash(source.preRegistrationHash, this.#database);
    const registeredAtMs = plan ? new Date(plan.registeredAt).valueOf() : Number.NaN;
    if (!plan || plan.datasetHash !== source.datasetHash ||
        plan.costProfileHash !== source.costProfileHash ||
        plan.codeRevision !== latest.codeRevision || !Number.isSafeInteger(registeredAtMs) ||
        registeredAtMs > source.createdAtMs) {
      return blocked(assessedAtMs, 'blocked_invalid_evidence', true);
    }
    const snapshot = parseEvidence(latest.resultJson);
    if (!snapshot) {
      return blocked(assessedAtMs, 'blocked_unsupported_evidence', true, source);
    }

    const checklist = evidenceGateChecklist(snapshot);
    const gates = freezeRiskValue(checklist.items.map(({ id, met }) => ({ code: id, met })));
    const facts: RiskEvidenceFacts = freezeRiskValue({
      evidenceDayMs: snapshot.dayMs,
      leader: snapshot.leader,
      dsr: snapshot.dsr,
      psr: snapshot.psr,
      significanceVerdict: snapshot.sigVerdict,
      walkForwardVerdict: snapshot.wfVerdict,
      leaderSortino: snapshot.leaderSortino,
      holdSortino: snapshot.holdSortino,
      passiveSortino: snapshot.passiveSortino,
      sampleDays: snapshot.sampleDays,
    });
    return finalize({
      schemaVersion: 1,
      assessedAtMs,
      status: checklist.allMet ? 'eligible_for_review' : 'requirements_not_met',
      trialHistoryComplete: true,
      source,
      facts,
      gates,
      conversationEligible: checklist.allMet,
      liveExecutionPermitted: false,
    });
  }
}
