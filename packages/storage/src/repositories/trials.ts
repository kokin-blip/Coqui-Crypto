import {
  createTrialRegistry,
  registerTrials,
  trialRecordHash,
  type TrialRecord,
  type TrialRegistryCompleteness,
  type TrialRegistrySnapshot,
} from '@coqui/core';

import type { Db } from '../sqlite/index.js';

interface TrialRow {
  id: string;
  family: TrialRecord['family'];
  search_kind: TrialRecord['searchKind'];
  evidence_status: TrialRecord['evidenceStatus'];
  parameter_space_json: string;
  trial_count: number;
  searched_at: string;
  dataset_hash: string | null;
  cost_profile_hash: string | null;
  code_revision: string;
  produced_defaults_json: string;
  study_ref: string;
  record_hash: string;
}

function recordFromRow(row: TrialRow): TrialRecord {
  return {
    id: row.id,
    family: row.family,
    searchKind: row.search_kind,
    evidenceStatus: row.evidence_status,
    parameterSpace: JSON.parse(row.parameter_space_json) as TrialRecord['parameterSpace'],
    trialCount: row.trial_count,
    searchedAt: row.searched_at,
    datasetHash: row.dataset_hash,
    costProfileHash: row.cost_profile_hash,
    codeRevision: row.code_revision,
    producedDefaults: JSON.parse(row.produced_defaults_json) as TrialRecord['producedDefaults'],
    studyRef: row.study_ref,
  };
}

/** Load the append-only registry and revalidate every persisted record through core. */
export function loadTrialRegistry(database: Db): TrialRegistrySnapshot {
  const meta = database.prepare(
    'SELECT completeness FROM trial_registry_meta WHERE singleton = 1',
  ).get() as { completeness: TrialRegistryCompleteness };
  const rows = database.prepare(
    'SELECT * FROM trial_registry_records ORDER BY sequence',
  ).all() as unknown as TrialRow[];
  let registry = createTrialRegistry(meta.completeness);
  for (const row of rows) {
    const record = recordFromRow(row);
    if (trialRecordHash(record) !== row.record_hash) {
      throw new Error('Persisted trial provenance failed integrity validation.');
    }
    registry = registerTrials(registry, record);
  }
  return registry;
}

/** Append one validated search; there is deliberately no update or delete path. */
export function appendTrialRecord(record: TrialRecord, database: Db): void {
  registerTrials(loadTrialRegistry(database), record);
  database.prepare(`
    INSERT INTO trial_registry_records (
      id, family, search_kind, evidence_status, parameter_space_json, trial_count,
      searched_at, dataset_hash, cost_profile_hash, code_revision,
      produced_defaults_json, study_ref, record_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.family,
    record.searchKind,
    record.evidenceStatus,
    JSON.stringify(record.parameterSpace),
    record.trialCount,
    record.searchedAt,
    record.datasetHash,
    record.costProfileHash,
    record.codeRevision,
    JSON.stringify(record.producedDefaults),
    record.studyRef,
    trialRecordHash(record),
  );
}
