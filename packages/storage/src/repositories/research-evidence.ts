import type { Db } from '../sqlite/index.js';

export interface StoredResearchEvidenceSnapshot {
  readonly id: string;
  readonly createdAtMs: number;
  readonly datasetHash: string;
  readonly trialRegistryHash: string;
  readonly costProfileHash: string;
  readonly codeRevision: string;
  readonly preRegistrationHash: string;
  readonly resultJson: string;
  readonly snapshotHash: string;
}

/** Persist one immutable P3 evidence snapshot. */
export function saveResearchEvidenceSnapshot(
  snapshot: StoredResearchEvidenceSnapshot,
  database: Db,
): void {
  JSON.parse(snapshot.resultJson);
  database.prepare(`
    INSERT INTO research_evidence_snapshots_v2 (
      id, created_at_ms, dataset_hash, trial_registry_hash, cost_profile_hash,
      code_revision, pre_registration_hash, result_json, snapshot_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.id,
    snapshot.createdAtMs,
    snapshot.datasetHash,
    snapshot.trialRegistryHash,
    snapshot.costProfileHash,
    snapshot.codeRevision,
    snapshot.preRegistrationHash,
    snapshot.resultJson,
    snapshot.snapshotHash,
  );
}

export function listResearchEvidenceSnapshots(
  database: Db,
): StoredResearchEvidenceSnapshot[] {
  const rows = database.prepare(`
    SELECT * FROM research_evidence_snapshots_v2 ORDER BY created_at_ms, id
  `).all() as unknown as Array<{
    id: string;
    created_at_ms: number;
    dataset_hash: string;
    trial_registry_hash: string;
    cost_profile_hash: string;
    code_revision: string;
    pre_registration_hash: string;
    result_json: string;
    snapshot_hash: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    createdAtMs: row.created_at_ms,
    datasetHash: row.dataset_hash,
    trialRegistryHash: row.trial_registry_hash,
    costProfileHash: row.cost_profile_hash,
    codeRevision: row.code_revision,
    preRegistrationHash: row.pre_registration_hash,
    resultJson: row.result_json,
    snapshotHash: row.snapshot_hash,
  }));
}
