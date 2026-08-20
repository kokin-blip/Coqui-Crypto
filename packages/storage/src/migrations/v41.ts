import type { Migration } from './types.js';

/** Secret-free, profile-scoped advisor presentation/runtime policy. */
export const migrations41: readonly Migration[] = [{
  version: 41,
  name: 'advisor_profile_model_policy',
  up: (db) => {
    db.exec(`
      CREATE TABLE advisor_profile_configs_v1 (
        profile_id        TEXT PRIMARY KEY,
        model_policy_id   TEXT NOT NULL CHECK (model_policy_id IN
          ('advisor_balanced_v1', 'advisor_fast_v1')),
        updated_at        INTEGER NOT NULL CHECK (updated_at >= 0)
      );
    `);
  },
}];
