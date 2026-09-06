import type { Migration } from './types.js';

export const migrations68: readonly Migration[] = [{
  version: 68,
  name: 'advisor_decision_evidence_and_navigation_v1',
  up(db) {
    db.exec(`
      CREATE TABLE advisor_decision_evidence_packs_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        decision_hash TEXT NOT NULL CHECK (length(decision_hash) = 64),
        latest_event_sequence INTEGER NOT NULL CHECK (latest_event_sequence >= -1),
        evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
        evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
        data_as_of INTEGER NOT NULL CHECK (data_as_of >= 0),
        freshness TEXT NOT NULL CHECK (freshness IN ('fresh','stale','unavailable')),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        UNIQUE(profile_id, decision_id, latest_event_sequence, freshness, created_at),
        FOREIGN KEY(decision_id, profile_id)
          REFERENCES strategy_decisions_v1(decision_id, profile_id)
      );
      CREATE INDEX advisor_decision_evidence_packs_v1_profile_time
        ON advisor_decision_evidence_packs_v1(profile_id, created_at DESC);

      CREATE TABLE advisor_navigation_audit_events_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        decision_id TEXT,
        target TEXT NOT NULL CHECK (target IN ('activity','paper','research','risk','market','advisor')),
        outcome TEXT NOT NULL CHECK (outcome IN ('accepted','rejected')),
        reason_code TEXT NOT NULL,
        at INTEGER NOT NULL CHECK (at >= 0),
        detail_json TEXT NOT NULL CHECK (json_valid(detail_json))
      );
      CREATE INDEX advisor_navigation_audit_events_v1_profile_time
        ON advisor_navigation_audit_events_v1(profile_id, at DESC);

      CREATE TRIGGER advisor_decision_evidence_packs_v1_no_update
        BEFORE UPDATE ON advisor_decision_evidence_packs_v1
        BEGIN SELECT RAISE(ABORT, 'advisor evidence packs are immutable'); END;
      CREATE TRIGGER advisor_decision_evidence_packs_v1_no_delete
        BEFORE DELETE ON advisor_decision_evidence_packs_v1
        BEGIN SELECT RAISE(ABORT, 'advisor evidence packs are immutable'); END;
      CREATE TRIGGER advisor_navigation_audit_events_v1_no_update
        BEFORE UPDATE ON advisor_navigation_audit_events_v1
        BEGIN SELECT RAISE(ABORT, 'advisor navigation audit is append-only'); END;
      CREATE TRIGGER advisor_navigation_audit_events_v1_no_delete
        BEFORE DELETE ON advisor_navigation_audit_events_v1
        BEGIN SELECT RAISE(ABORT, 'advisor navigation audit is append-only'); END;
    `);
  },
}];
