import { sha256Hex, type JsonValue } from '@coqui/core';

import type { Db } from '../sqlite/index.js';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export interface StoredResearchStudyRun {
  readonly id: string;
  readonly preRegistrationHash: string;
  readonly completedAtMs: number;
  readonly datasetHash: string;
  readonly costProfileHash: string;
  readonly codeRevision: string;
  readonly selectedCandidateId: string;
  readonly adopted: boolean;
  readonly resultJson: string;
  readonly runHash: string;
}

export type ResearchStudyRunWithoutHash = Omit<StoredResearchStudyRun, 'runHash'>;

function canonical(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Study results cannot contain non-finite numbers.');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('Study results must be JSON-serializable.');
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
}

export function canonicalStudyResult(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function researchStudyRunHash(run: ResearchStudyRunWithoutHash): string {
  return sha256Hex(JSON.stringify(run));
}

function validate(run: StoredResearchStudyRun): void {
  if (run.id.length === 0 || run.id.length > 200 || !Number.isSafeInteger(run.completedAtMs) ||
      run.completedAtMs < 0 || run.codeRevision.length === 0 || run.codeRevision.length > 200 ||
      !HASH_PATTERN.test(run.preRegistrationHash) || !HASH_PATTERN.test(run.datasetHash) ||
      !HASH_PATTERN.test(run.costProfileHash) || !HASH_PATTERN.test(run.selectedCandidateId) ||
      !HASH_PATTERN.test(run.runHash)) {
    throw new TypeError('Research study run contains invalid provenance.');
  }
  JSON.parse(run.resultJson);
  if (researchStudyRunHash({
    id: run.id,
    preRegistrationHash: run.preRegistrationHash,
    completedAtMs: run.completedAtMs,
    datasetHash: run.datasetHash,
    costProfileHash: run.costProfileHash,
    codeRevision: run.codeRevision,
    selectedCandidateId: run.selectedCandidateId,
    adopted: run.adopted,
    resultJson: run.resultJson,
  }) !== run.runHash) throw new Error('Research study run failed content verification.');
}

/** Persist a result even when incomplete legacy history prevents citable evidence. */
export function saveResearchStudyRun(run: StoredResearchStudyRun, database: Db): void {
  validate(run);
  database.prepare(`
    INSERT INTO research_study_runs (
      id, pre_registration_hash, completed_at_ms, dataset_hash, cost_profile_hash,
      code_revision, selected_candidate_id, adopted, result_json, run_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id, run.preRegistrationHash, run.completedAtMs, run.datasetHash, run.costProfileHash,
    run.codeRevision, run.selectedCandidateId, run.adopted ? 1 : 0, run.resultJson, run.runHash,
  );
}

function fromRow(row: {
  id: string; pre_registration_hash: string; completed_at_ms: number; dataset_hash: string;
  cost_profile_hash: string; code_revision: string; selected_candidate_id: string;
  adopted: number; result_json: string; run_hash: string;
}): StoredResearchStudyRun {
  return {
    id: row.id,
    preRegistrationHash: row.pre_registration_hash,
    completedAtMs: row.completed_at_ms,
    datasetHash: row.dataset_hash,
    costProfileHash: row.cost_profile_hash,
    codeRevision: row.code_revision,
    selectedCandidateId: row.selected_candidate_id,
    adopted: row.adopted === 1,
    resultJson: row.result_json,
    runHash: row.run_hash,
  };
}

/** Load and content-verify every immutable registered study result. */
export function verifiedResearchStudyRuns(database: Db): readonly StoredResearchStudyRun[] {
  const rows = database.prepare(
    'SELECT * FROM research_study_runs ORDER BY completed_at_ms, id',
  ).all() as unknown as Array<Parameters<typeof fromRow>[0]>;
  return Object.freeze(rows.map((row) => {
    const run = Object.freeze(fromRow(row));
    validate(run);
    return run;
  }));
}
