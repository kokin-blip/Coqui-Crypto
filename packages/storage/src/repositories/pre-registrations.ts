import type { Db } from '../sqlite/index.js';

export interface StoredResearchPreRegistration {
  readonly id: string;
  readonly registeredAt: string;
  readonly family: string;
  readonly candidateCount: number;
  readonly datasetHash: string;
  readonly costProfileHash: string;
  readonly codeRevision: string;
  readonly planJson: string;
  readonly planHash: string;
}

/** Insert one study declaration. SQLite triggers intentionally provide no edit path. */
export function saveResearchPreRegistration(
  plan: StoredResearchPreRegistration,
  database: Db,
): void {
  JSON.parse(plan.planJson);
  database.prepare(`
    INSERT INTO research_preregistrations (
      id, registered_at, family, candidate_count, dataset_hash,
      cost_profile_hash, code_revision, plan_json, plan_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    plan.id,
    plan.registeredAt,
    plan.family,
    plan.candidateCount,
    plan.datasetHash,
    plan.costProfileHash,
    plan.codeRevision,
    plan.planJson,
    plan.planHash,
  );
}

function fromRow(row: {
  id: string;
  registered_at: string;
  family: string;
  candidate_count: number;
  dataset_hash: string;
  cost_profile_hash: string;
  code_revision: string;
  plan_json: string;
  plan_hash: string;
}): StoredResearchPreRegistration {
  return {
    id: row.id,
    registeredAt: row.registered_at,
    family: row.family,
    candidateCount: row.candidate_count,
    datasetHash: row.dataset_hash,
    costProfileHash: row.cost_profile_hash,
    codeRevision: row.code_revision,
    planJson: row.plan_json,
    planHash: row.plan_hash,
  };
}

export function findResearchPreRegistrationByHash(
  planHash: string,
  database: Db,
): StoredResearchPreRegistration | null {
  const row = database.prepare(`
    SELECT * FROM research_preregistrations WHERE plan_hash = ?
  `).get(planHash) as Parameters<typeof fromRow>[0] | undefined;
  return row === undefined ? null : fromRow(row);
}

export function listResearchPreRegistrations(database: Db): StoredResearchPreRegistration[] {
  const rows = database.prepare(`
    SELECT * FROM research_preregistrations ORDER BY registered_at, id
  `).all() as unknown as Array<Parameters<typeof fromRow>[0]>;
  return rows.map(fromRow);
}
