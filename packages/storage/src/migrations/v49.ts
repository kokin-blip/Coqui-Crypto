import type { Migration } from './types.js';

/** Immutable prospective edge plans, results, activations, and their status ledger. */
export const migrations49: readonly Migration[] = [{
  version: 49,
  name: 'forward_edge_evidence',
  up: (db) => {
    db.exec(`
      CREATE TABLE forward_edge_study_plans_v1 (
        plan_hash TEXT PRIMARY KEY CHECK (length(plan_hash) = 64),
        registered_at INTEGER NOT NULL CHECK (registered_at >= 0),
        code_revision TEXT NOT NULL,
        cost_profile_hash TEXT NOT NULL CHECK (length(cost_profile_hash) = 64),
        plan_json TEXT NOT NULL CHECK (json_valid(plan_json) AND json_type(plan_json) = 'object')
      );
      CREATE TABLE forward_edge_study_results_v1 (
        result_hash TEXT PRIMARY KEY CHECK (length(result_hash) = 64),
        plan_hash TEXT NOT NULL REFERENCES forward_edge_study_plans_v1(plan_hash),
        completed_at INTEGER NOT NULL CHECK (completed_at >= 0),
        passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
        integrity_verified INTEGER NOT NULL CHECK (integrity_verified IN (0, 1)),
        gross_edge_lower_bound_pct_text TEXT NOT NULL,
        result_json TEXT NOT NULL CHECK (json_valid(result_json) AND json_type(result_json) = 'object')
      );
      CREATE TABLE profitability_estimate_evidence_v1 (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        result_hash TEXT NOT NULL REFERENCES forward_edge_study_results_v1(result_hash),
        gross_edge_lower_bound_pct_text TEXT NOT NULL,
        source_hashes_json TEXT NOT NULL CHECK (json_valid(source_hashes_json) AND json_type(source_hashes_json) = 'array'),
        activated_at INTEGER NOT NULL CHECK (activated_at >= 0),
        command_id TEXT NOT NULL UNIQUE
      );
      CREATE INDEX profitability_estimate_evidence_v1_profile_time
        ON profitability_estimate_evidence_v1(profile_id, activated_at DESC);
      CREATE TABLE forward_edge_status_events_v1 (
        id TEXT PRIMARY KEY,
        plan_hash TEXT NOT NULL REFERENCES forward_edge_study_plans_v1(plan_hash),
        at INTEGER NOT NULL CHECK (at >= 0),
        status TEXT NOT NULL CHECK (status IN ('registered','collecting','ready','passed','failed','activated')),
        evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
        details_json TEXT NOT NULL CHECK (json_valid(details_json) AND json_type(details_json) = 'object')
      );
      CREATE INDEX forward_edge_status_events_v1_plan_time
        ON forward_edge_status_events_v1(plan_hash, at);

      CREATE TRIGGER forward_edge_study_plans_v1_no_update BEFORE UPDATE ON forward_edge_study_plans_v1
        BEGIN SELECT RAISE(ABORT, 'forward edge plans are immutable'); END;
      CREATE TRIGGER forward_edge_study_plans_v1_no_delete BEFORE DELETE ON forward_edge_study_plans_v1
        BEGIN SELECT RAISE(ABORT, 'forward edge plans are immutable'); END;
      CREATE TRIGGER forward_edge_study_results_v1_no_update BEFORE UPDATE ON forward_edge_study_results_v1
        BEGIN SELECT RAISE(ABORT, 'forward edge results are immutable'); END;
      CREATE TRIGGER forward_edge_study_results_v1_no_delete BEFORE DELETE ON forward_edge_study_results_v1
        BEGIN SELECT RAISE(ABORT, 'forward edge results are immutable'); END;
      CREATE TRIGGER profitability_estimate_evidence_v1_no_update BEFORE UPDATE ON profitability_estimate_evidence_v1
        BEGIN SELECT RAISE(ABORT, 'profitability evidence is immutable'); END;
      CREATE TRIGGER profitability_estimate_evidence_v1_no_delete BEFORE DELETE ON profitability_estimate_evidence_v1
        BEGIN SELECT RAISE(ABORT, 'profitability evidence is immutable'); END;
      CREATE TRIGGER forward_edge_status_events_v1_no_update BEFORE UPDATE ON forward_edge_status_events_v1
        BEGIN SELECT RAISE(ABORT, 'forward edge status is append-only'); END;
      CREATE TRIGGER forward_edge_status_events_v1_no_delete BEFORE DELETE ON forward_edge_status_events_v1
        BEGIN SELECT RAISE(ABORT, 'forward edge status is append-only'); END;
    `);
  },
}];
