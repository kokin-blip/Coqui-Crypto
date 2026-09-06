import type { Migration } from './types.js';

export const migrations60: readonly Migration[] = [{
  version: 60,
  name: 'paper_pending_executions_v1',
  up(db) {
    db.exec(`
      ALTER TABLE paper_execution_attempts_v1 RENAME TO paper_execution_attempts_v1_old;
      CREATE TABLE paper_execution_attempts_v1 (
        id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL UNIQUE,
        proposal_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        proposal_hash TEXT NOT NULL CHECK (length(proposal_hash) = 64),
        status TEXT NOT NULL CHECK (status IN (
          'pending', 'submitted', 'blocked', 'failed', 'succeeded', 'unknown'
        )),
        outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json)),
        check_snapshot_hash TEXT NOT NULL CHECK (length(check_snapshot_hash) = 64),
        check_snapshot_json TEXT NOT NULL CHECK (json_valid(check_snapshot_json)),
        started_at INTEGER NOT NULL CHECK (started_at >= 0),
        completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= started_at),
        FOREIGN KEY (proposal_id) REFERENCES paper_execution_proposals_v1(id)
      );
      INSERT INTO paper_execution_attempts_v1 SELECT * FROM paper_execution_attempts_v1_old;
      DROP TABLE paper_execution_attempts_v1_old;

      CREATE TABLE paper_pending_executions_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        decision_id TEXT NOT NULL REFERENCES strategy_decisions_v1(decision_id),
        order_id TEXT NOT NULL UNIQUE REFERENCES paper_orders_v3(id),
        required_bar_start INTEGER NOT NULL CHECK (required_bar_start >= 0),
        rule_snapshot_id TEXT NOT NULL REFERENCES paper_product_rule_snapshots_v3(id),
        cost_model_hash TEXT NOT NULL CHECK (length(cost_model_hash) = 64),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        status TEXT NOT NULL CHECK (status IN ('submitted','filled','expired')),
        submitted_at INTEGER NOT NULL CHECK (submitted_at >= 0),
        settled_at INTEGER
      );
      CREATE INDEX paper_pending_executions_v1_due
        ON paper_pending_executions_v1(profile_id, status, required_bar_start);
      CREATE TABLE paper_proposal_pending_context_v1 (
        proposal_id TEXT PRIMARY KEY REFERENCES paper_execution_proposals_v1(id),
        decision_id TEXT NOT NULL REFERENCES strategy_decisions_v1(decision_id),
        required_bar_start INTEGER NOT NULL CHECK (required_bar_start >= 0),
        cost_model_hash TEXT NOT NULL CHECK (length(cost_model_hash) = 64)
      );
      CREATE TABLE paper_pending_execution_events_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        pending_id TEXT NOT NULL REFERENCES paper_pending_executions_v1(id),
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        status TEXT NOT NULL CHECK (status IN ('submitted','filled','expired')),
        at INTEGER NOT NULL CHECK (at >= 0),
        detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
        UNIQUE(pending_id, sequence)
      );
      CREATE TRIGGER paper_pending_execution_identity_immutable
      BEFORE UPDATE OF id, profile_id, decision_id, order_id, required_bar_start,
        rule_snapshot_id, cost_model_hash, content_json, content_hash, submitted_at
      ON paper_pending_executions_v1
      BEGIN SELECT RAISE(ABORT, 'pending execution identity is immutable'); END;
      CREATE TRIGGER paper_pending_execution_profile_guard
      BEFORE INSERT ON paper_pending_executions_v1
      WHEN (SELECT profile_id FROM strategy_decisions_v1 WHERE decision_id = NEW.decision_id)
             <> NEW.profile_id
        OR (SELECT profile_id FROM paper_orders_v3 WHERE id = NEW.order_id) <> NEW.profile_id
      BEGIN SELECT RAISE(ABORT, 'pending execution profile mismatch'); END;
      CREATE TRIGGER paper_pending_execution_terminal_guard
      BEFORE UPDATE OF status, settled_at ON paper_pending_executions_v1
      WHEN OLD.status <> 'submitted'
        OR NEW.status NOT IN ('filled', 'expired')
        OR NEW.settled_at IS NULL
      BEGIN SELECT RAISE(ABORT, 'invalid pending execution transition'); END;
      CREATE TRIGGER paper_pending_executions_no_delete
      BEFORE DELETE ON paper_pending_executions_v1
      BEGIN SELECT RAISE(ABORT, 'pending executions are immutable'); END;
      CREATE TRIGGER paper_proposal_pending_context_no_update
      BEFORE UPDATE ON paper_proposal_pending_context_v1
      BEGIN SELECT RAISE(ABORT, 'pending proposal context is immutable'); END;
      CREATE TRIGGER paper_proposal_pending_context_no_delete
      BEFORE DELETE ON paper_proposal_pending_context_v1
      BEGIN SELECT RAISE(ABORT, 'pending proposal context is immutable'); END;
      CREATE TRIGGER paper_pending_execution_events_no_update
      BEFORE UPDATE ON paper_pending_execution_events_v1
      BEGIN SELECT RAISE(ABORT, 'pending execution events are append-only'); END;
      CREATE TRIGGER paper_pending_execution_events_no_delete
      BEFORE DELETE ON paper_pending_execution_events_v1
      BEGIN SELECT RAISE(ABORT, 'pending execution events are append-only'); END;
    `);
  },
}];
