import type { Migration } from './types.js';

/** Durable policy, proposal, review and attempt evidence for paper execution. */
export const migrations47: readonly Migration[] = [{
  version: 47,
  name: 'authoritative_paper_execution_boundary',
  up: (db) => {
    db.exec(`
      CREATE TABLE paper_execution_policies_v1 (
        profile_id       TEXT PRIMARY KEY,
        mode             TEXT NOT NULL CHECK (mode IN ('off', 'review_required', 'unattended')),
        revision         INTEGER NOT NULL CHECK (revision > 0),
        provenance_hash  TEXT NOT NULL CHECK (length(provenance_hash) = 64),
        confirmed_at     INTEGER NOT NULL CHECK (confirmed_at >= 0),
        updated_at       INTEGER NOT NULL CHECK (updated_at >= 0)
      );

      CREATE TABLE paper_execution_policy_events_v1 (
        id               TEXT PRIMARY KEY,
        command_id       TEXT NOT NULL UNIQUE,
        profile_id       TEXT NOT NULL,
        mode             TEXT NOT NULL CHECK (mode IN ('off', 'review_required', 'unattended')),
        revision         INTEGER NOT NULL CHECK (revision > 0),
        provenance_hash  TEXT NOT NULL CHECK (length(provenance_hash) = 64),
        confirmed_at     INTEGER NOT NULL CHECK (confirmed_at >= 0),
        detail_json      TEXT NOT NULL CHECK (json_valid(detail_json))
      );

      CREATE TABLE paper_execution_proposals_v1 (
        id               TEXT PRIMARY KEY,
        profile_id       TEXT NOT NULL,
        run_id           TEXT NOT NULL,
        revision         INTEGER NOT NULL CHECK (revision > 0),
        proposal_hash    TEXT NOT NULL CHECK (length(proposal_hash) = 64),
        intents_json     TEXT NOT NULL CHECK (json_valid(intents_json) AND json_type(intents_json) = 'array'),
        status           TEXT NOT NULL CHECK (status IN (
          'pending_review', 'approved', 'rejected', 'executing',
          'blocked', 'failed', 'succeeded', 'unknown'
        )),
        created_at       INTEGER NOT NULL CHECK (created_at >= 0),
        updated_at       INTEGER NOT NULL CHECK (updated_at >= 0),
        UNIQUE (profile_id, run_id, revision),
        UNIQUE (profile_id, proposal_hash)
      );

      CREATE INDEX paper_execution_proposals_v1_profile_status
        ON paper_execution_proposals_v1 (profile_id, status, updated_at DESC, id);

      CREATE TABLE paper_execution_reviews_v1 (
        id               TEXT PRIMARY KEY,
        command_id       TEXT NOT NULL UNIQUE,
        proposal_id      TEXT NOT NULL,
        profile_id       TEXT NOT NULL,
        proposal_hash    TEXT NOT NULL CHECK (length(proposal_hash) = 64),
        decision         TEXT NOT NULL CHECK (decision IN (
          'human_approved', 'human_rejected', 'system_not_required'
        )),
        reviewer         TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 80),
        note             TEXT NOT NULL CHECK (length(note) <= 500),
        decided_at       INTEGER NOT NULL CHECK (decided_at >= 0),
        FOREIGN KEY (proposal_id) REFERENCES paper_execution_proposals_v1(id)
      );

      CREATE TABLE paper_execution_attempts_v1 (
        id                  TEXT PRIMARY KEY,
        command_id          TEXT NOT NULL UNIQUE,
        proposal_id         TEXT NOT NULL,
        profile_id          TEXT NOT NULL,
        proposal_hash       TEXT NOT NULL CHECK (length(proposal_hash) = 64),
        status              TEXT NOT NULL CHECK (status IN (
          'pending', 'blocked', 'failed', 'succeeded', 'unknown'
        )),
        outcome_json        TEXT NOT NULL CHECK (json_valid(outcome_json)),
        check_snapshot_hash TEXT NOT NULL CHECK (length(check_snapshot_hash) = 64),
        check_snapshot_json TEXT NOT NULL CHECK (json_valid(check_snapshot_json)),
        started_at          INTEGER NOT NULL CHECK (started_at >= 0),
        completed_at        INTEGER CHECK (completed_at IS NULL OR completed_at >= started_at),
        FOREIGN KEY (proposal_id) REFERENCES paper_execution_proposals_v1(id)
      );

      CREATE TABLE paper_execution_events_v1 (
        id            TEXT PRIMARY KEY,
        proposal_id   TEXT NOT NULL,
        profile_id    TEXT NOT NULL,
        sequence      INTEGER NOT NULL CHECK (sequence >= 0),
        kind          TEXT NOT NULL CHECK (kind IN (
          'prepared', 'reviewed', 'submission_started', 'blocked',
          'failed', 'succeeded', 'unknown'
        )),
        at            INTEGER NOT NULL CHECK (at >= 0),
        detail_json   TEXT NOT NULL CHECK (json_valid(detail_json)),
        UNIQUE (proposal_id, sequence),
        FOREIGN KEY (proposal_id) REFERENCES paper_execution_proposals_v1(id)
      );

      CREATE TRIGGER paper_execution_policy_events_v1_no_update
      BEFORE UPDATE ON paper_execution_policy_events_v1
      BEGIN SELECT RAISE(ABORT, 'paper execution policy events are append-only'); END;
      CREATE TRIGGER paper_execution_policy_events_v1_no_delete
      BEFORE DELETE ON paper_execution_policy_events_v1
      BEGIN SELECT RAISE(ABORT, 'paper execution policy events are append-only'); END;
      CREATE TRIGGER paper_execution_reviews_v1_no_update
      BEFORE UPDATE ON paper_execution_reviews_v1
      BEGIN SELECT RAISE(ABORT, 'paper execution reviews are append-only'); END;
      CREATE TRIGGER paper_execution_reviews_v1_no_delete
      BEFORE DELETE ON paper_execution_reviews_v1
      BEGIN SELECT RAISE(ABORT, 'paper execution reviews are append-only'); END;
      CREATE TRIGGER paper_execution_events_v1_no_update
      BEFORE UPDATE ON paper_execution_events_v1
      BEGIN SELECT RAISE(ABORT, 'paper execution events are append-only'); END;
      CREATE TRIGGER paper_execution_events_v1_no_delete
      BEFORE DELETE ON paper_execution_events_v1
      BEGIN SELECT RAISE(ABORT, 'paper execution events are append-only'); END;
    `);
  },
}];
