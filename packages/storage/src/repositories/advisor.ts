import type { Db } from '../sqlite/index.js';

export type StoredAdvisorModelPolicyId =
  | 'advisor_balanced_v1'
  | 'advisor_fast_v1';

export interface StoredAdvisorProfileConfig {
  readonly profileId: string;
  readonly modelPolicyId: StoredAdvisorModelPolicyId;
  readonly updatedAt: number;
}

/** Read only non-secret advisor configuration. Credentials never enter SQLite. */
export function getAdvisorProfileConfig(
  profileId: string,
  database: Db,
): StoredAdvisorProfileConfig | null {
  const row = database.prepare(`
    SELECT profile_id, model_policy_id, updated_at
    FROM advisor_profile_configs_v1
    WHERE profile_id = ?
  `).get(profileId) as Record<string, unknown> | undefined;
  return row ? {
    profileId: row['profile_id'] as string,
    modelPolicyId: row['model_policy_id'] as StoredAdvisorModelPolicyId,
    updatedAt: row['updated_at'] as number,
  } : null;
}

/** Replace one profile's already-validated, allowlisted model policy. */
export function saveAdvisorProfileConfig(
  config: StoredAdvisorProfileConfig,
  database: Db,
): void {
  database.prepare(`
    INSERT INTO advisor_profile_configs_v1 (profile_id, model_policy_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      model_policy_id = excluded.model_policy_id,
      updated_at = excluded.updated_at
  `).run(config.profileId, config.modelPolicyId, config.updatedAt);
}

/** Clear non-secret advisor configuration without touching another profile. */
export function removeAdvisorProfileConfig(profileId: string, database: Db): boolean {
  const result = database.prepare(
    'DELETE FROM advisor_profile_configs_v1 WHERE profile_id = ?',
  ).run(profileId);
  return Number(result.changes) === 1;
}
