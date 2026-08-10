import type { Migration } from './types.js';

/** Immutable study plans and mandatory evidence-to-plan provenance. */
export const migrations36: readonly Migration[] = [{
  version: 36,
  name: 'research_preregistration',
  up: (db) => {
    db.exec(`
      CREATE TABLE research_preregistrations (
        id                 TEXT PRIMARY KEY,
        registered_at     TEXT NOT NULL,
        family             TEXT NOT NULL CHECK (family IN
          ('momentum', 'voltarget', 'trendvol', 'signal-tilt', 'rotation')),
        candidate_count    INTEGER NOT NULL CHECK (candidate_count > 0),
        dataset_hash       TEXT NOT NULL CHECK (length(dataset_hash) = 64),
        cost_profile_hash  TEXT NOT NULL CHECK (length(cost_profile_hash) = 64),
        code_revision      TEXT NOT NULL,
        plan_json          TEXT NOT NULL CHECK (json_valid(plan_json)),
        plan_hash          TEXT NOT NULL UNIQUE CHECK (length(plan_hash) = 64)
      );

      CREATE TRIGGER research_preregistrations_no_update
      BEFORE UPDATE ON research_preregistrations
      BEGIN SELECT RAISE(ABORT, 'research pre-registration is immutable'); END;

      CREATE TRIGGER research_preregistrations_no_delete
      BEFORE DELETE ON research_preregistrations
      BEGIN SELECT RAISE(ABORT, 'research pre-registration is immutable'); END;

      ALTER TABLE research_evidence_snapshots_v2
        ADD COLUMN pre_registration_hash TEXT REFERENCES research_preregistrations(plan_hash);

      CREATE TRIGGER research_evidence_v2_requires_preregistration
      BEFORE INSERT ON research_evidence_snapshots_v2
      WHEN NEW.pre_registration_hash IS NULL
        OR length(NEW.pre_registration_hash) != 64
        OR NOT EXISTS (
          SELECT 1 FROM research_preregistrations
          WHERE plan_hash = NEW.pre_registration_hash
        )
      BEGIN SELECT RAISE(ABORT, 'research evidence requires a registered plan'); END;
    `);
  },
}];
