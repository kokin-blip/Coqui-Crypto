import type { Migration } from './types.js';

/** Append-only P3 search provenance and immutable research evidence. */
export const migrations35: readonly Migration[] = [{
  version: 35,
  name: 'trial_registry_and_research_evidence_v2',
  up: (db) => {
    db.exec(`
      CREATE TABLE trial_registry_meta (
        singleton     INTEGER PRIMARY KEY CHECK (singleton = 1),
        completeness  TEXT NOT NULL CHECK (completeness IN ('complete', 'known-lower-bound'))
      );

      INSERT INTO trial_registry_meta (singleton, completeness)
      VALUES (1, 'known-lower-bound');

      CREATE TABLE trial_registry_records (
        sequence                 INTEGER PRIMARY KEY AUTOINCREMENT,
        id                       TEXT NOT NULL UNIQUE,
        family                   TEXT NOT NULL CHECK (family IN
          ('momentum', 'voltarget', 'trendvol', 'signal-tilt', 'rotation')),
        search_kind              TEXT NOT NULL CHECK (search_kind IN
          ('grid', 'random', 'bayesian', 'human-guided', 'feature-screen', 'other')),
        evidence_status          TEXT NOT NULL CHECK (evidence_status IN
          ('verified', 'legacy-unresolved')),
        parameter_space_json     TEXT NOT NULL CHECK (json_valid(parameter_space_json)),
        trial_count              INTEGER NOT NULL CHECK (trial_count > 0),
        searched_at              TEXT NOT NULL,
        dataset_hash             TEXT,
        cost_profile_hash        TEXT,
        code_revision            TEXT NOT NULL,
        produced_defaults_json   TEXT NOT NULL CHECK (json_valid(produced_defaults_json)),
        study_ref                TEXT NOT NULL,
        record_hash              TEXT NOT NULL UNIQUE,
        CHECK (
          evidence_status = 'legacy-unresolved' OR
          (length(dataset_hash) = 64 AND length(cost_profile_hash) = 64)
        )
      );

      CREATE INDEX idx_trial_registry_family_sequence
        ON trial_registry_records (family, sequence);

      CREATE TRIGGER trial_registry_records_no_update
      BEFORE UPDATE ON trial_registry_records
      BEGIN SELECT RAISE(ABORT, 'trial registry is append-only'); END;

      CREATE TRIGGER trial_registry_records_no_delete
      BEFORE DELETE ON trial_registry_records
      BEGIN SELECT RAISE(ABORT, 'trial registry is append-only'); END;

      CREATE TABLE research_evidence_snapshots_v2 (
        id                   TEXT PRIMARY KEY,
        created_at_ms        INTEGER NOT NULL CHECK (created_at_ms >= 0),
        dataset_hash         TEXT NOT NULL CHECK (length(dataset_hash) = 64),
        trial_registry_hash  TEXT NOT NULL CHECK (length(trial_registry_hash) = 64),
        cost_profile_hash    TEXT NOT NULL CHECK (length(cost_profile_hash) = 64),
        code_revision        TEXT NOT NULL,
        result_json          TEXT NOT NULL CHECK (json_valid(result_json)),
        snapshot_hash        TEXT NOT NULL UNIQUE CHECK (length(snapshot_hash) = 64)
      );

      CREATE TRIGGER research_evidence_v2_no_update
      BEFORE UPDATE ON research_evidence_snapshots_v2
      BEGIN SELECT RAISE(ABORT, 'research evidence is immutable'); END;

      CREATE TRIGGER research_evidence_v2_no_delete
      BEFORE DELETE ON research_evidence_snapshots_v2
      BEGIN SELECT RAISE(ABORT, 'research evidence is immutable'); END;
    `);
  },
}];
