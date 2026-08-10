import type { Migration } from './types.js';

/** Append-only result record for every executed pre-registered study. */
export const migrations37: readonly Migration[] = [{
  version: 37,
  name: 'immutable_research_study_runs',
  up: (db) => {
    db.exec(`
      CREATE TABLE research_study_runs (
        id                     TEXT PRIMARY KEY,
        pre_registration_hash  TEXT NOT NULL UNIQUE
          REFERENCES research_preregistrations(plan_hash),
        completed_at_ms        INTEGER NOT NULL CHECK (completed_at_ms >= 0),
        dataset_hash           TEXT NOT NULL CHECK (length(dataset_hash) = 64),
        cost_profile_hash      TEXT NOT NULL CHECK (length(cost_profile_hash) = 64),
        code_revision          TEXT NOT NULL,
        selected_candidate_id  TEXT NOT NULL CHECK (length(selected_candidate_id) = 64),
        adopted                INTEGER NOT NULL CHECK (adopted IN (0, 1)),
        result_json            TEXT NOT NULL CHECK (json_valid(result_json)),
        run_hash               TEXT NOT NULL UNIQUE CHECK (length(run_hash) = 64)
      );

      CREATE TRIGGER research_study_runs_no_update
      BEFORE UPDATE ON research_study_runs
      BEGIN SELECT RAISE(ABORT, 'research study runs are immutable'); END;

      CREATE TRIGGER research_study_runs_no_delete
      BEFORE DELETE ON research_study_runs
      BEGIN SELECT RAISE(ABORT, 'research study runs are immutable'); END;
    `);
  },
}];
