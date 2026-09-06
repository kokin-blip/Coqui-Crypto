import type { Migration } from './types.js';

export const migrations67: readonly Migration[] = [{
  version: 67,
  name: 'research_workers_and_evolution_v1',
  up(db) {
    db.exec(`
      CREATE TABLE research_worker_attempts_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        job_id TEXT NOT NULL,
        attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
        protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
        envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
        envelope_hash TEXT NOT NULL CHECK (length(envelope_hash) = 64),
        status TEXT NOT NULL CHECK (status IN
          ('running','completed','cancelled','failed','timed_out')),
        started_at INTEGER NOT NULL CHECK (started_at >= 0),
        completed_at INTEGER,
        result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
        result_hash TEXT CHECK (result_hash IS NULL OR length(result_hash) = 64),
        error_code TEXT,
        UNIQUE(job_id, attempt_number),
        FOREIGN KEY(job_id) REFERENCES research_jobs(id)
      );
      CREATE INDEX research_worker_attempts_v1_job_time
        ON research_worker_attempts_v1(job_id, started_at DESC);

      CREATE TABLE research_candidates_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        family TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        parent_id TEXT,
        evidence_id TEXT NOT NULL,
        evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
        metrics_json TEXT NOT NULL CHECK (json_valid(metrics_json)),
        metrics_hash TEXT NOT NULL CHECK (length(metrics_hash) = 64),
        state TEXT NOT NULL CHECK (state IN ('promotion_eligible','rejected')),
        reason_codes_json TEXT NOT NULL CHECK (json_valid(reason_codes_json)),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        FOREIGN KEY(parent_id) REFERENCES research_candidates_v1(id)
      );
      CREATE INDEX research_candidates_v1_family_time
        ON research_candidates_v1(family, created_at DESC);

      CREATE TABLE research_champions_v1 (
        family TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        activation_id TEXT NOT NULL CHECK (length(activation_id) = 64),
        fencing_generation INTEGER NOT NULL CHECK (fencing_generation > 0),
        activated_at INTEGER NOT NULL CHECK (activated_at >= 0),
        FOREIGN KEY(candidate_id) REFERENCES research_candidates_v1(id)
      );
      CREATE TABLE research_activation_history_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        family TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('activate','rollback')),
        candidate_id TEXT NOT NULL,
        prior_candidate_id TEXT,
        approval_ref TEXT NOT NULL,
        fencing_generation INTEGER NOT NULL CHECK (fencing_generation > 0),
        at INTEGER NOT NULL CHECK (at >= 0),
        FOREIGN KEY(candidate_id) REFERENCES research_candidates_v1(id)
      );
      CREATE INDEX research_activation_history_v1_family_time
        ON research_activation_history_v1(family, at DESC);

      CREATE TABLE research_triggers_v1 (
        id TEXT PRIMARY KEY,
        family TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('scheduled','event')),
        debounce_ms INTEGER NOT NULL CHECK (debounce_ms >= 0),
        cooldown_ms INTEGER NOT NULL CHECK (cooldown_ms >= 0),
        max_duration_ms INTEGER NOT NULL CHECK (max_duration_ms > 0),
        trial_budget INTEGER NOT NULL CHECK (trial_budget > 0),
        trials_used INTEGER NOT NULL DEFAULT 0 CHECK (trials_used >= 0),
        last_triggered_at INTEGER,
        pending_since INTEGER,
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
      );
      CREATE TABLE research_trigger_events_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        trigger_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('scheduled','debounced','started','blocked')),
        reason_code TEXT NOT NULL,
        at INTEGER NOT NULL CHECK (at >= 0),
        detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
        FOREIGN KEY(trigger_id) REFERENCES research_triggers_v1(id)
      );

      CREATE TRIGGER research_worker_attempt_identity_v1 BEFORE UPDATE ON research_worker_attempts_v1
        WHEN OLD.job_id != NEW.job_id OR OLD.attempt_number != NEW.attempt_number OR
          OLD.protocol_version != NEW.protocol_version OR OLD.envelope_json != NEW.envelope_json OR
          OLD.envelope_hash != NEW.envelope_hash OR OLD.started_at != NEW.started_at OR
          (OLD.result_hash IS NOT NULL AND (NEW.result_hash IS NULL OR OLD.result_hash != NEW.result_hash))
        BEGIN SELECT RAISE(ABORT, 'research worker attempt identity/result is immutable'); END;
      CREATE TRIGGER research_worker_attempt_terminal_v1 BEFORE UPDATE ON research_worker_attempts_v1
        WHEN OLD.status != 'running'
        BEGIN SELECT RAISE(ABORT, 'terminal research worker attempts are immutable'); END;
      CREATE TRIGGER research_worker_attempts_v1_no_delete BEFORE DELETE ON research_worker_attempts_v1
        BEGIN SELECT RAISE(ABORT, 'research worker attempts are durable'); END;
      CREATE TRIGGER research_candidates_v1_no_update BEFORE UPDATE ON research_candidates_v1
        BEGIN SELECT RAISE(ABORT, 'research candidates are immutable'); END;
      CREATE TRIGGER research_candidates_v1_no_delete BEFORE DELETE ON research_candidates_v1
        BEGIN SELECT RAISE(ABORT, 'research candidates are immutable'); END;
      CREATE TRIGGER research_activation_history_v1_no_update BEFORE UPDATE ON research_activation_history_v1
        BEGIN SELECT RAISE(ABORT, 'research activation history is append-only'); END;
      CREATE TRIGGER research_activation_history_v1_no_delete BEFORE DELETE ON research_activation_history_v1
        BEGIN SELECT RAISE(ABORT, 'research activation history is append-only'); END;
      CREATE TRIGGER research_trigger_events_v1_no_update BEFORE UPDATE ON research_trigger_events_v1
        BEGIN SELECT RAISE(ABORT, 'research trigger events are append-only'); END;
      CREATE TRIGGER research_trigger_events_v1_no_delete BEFORE DELETE ON research_trigger_events_v1
        BEGIN SELECT RAISE(ABORT, 'research trigger events are append-only'); END;
    `);
  },
}];
