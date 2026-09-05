import type { Migration } from './types.js';

/** Immutable strategy decisions and append-only evidence events. */
export const migrations58: readonly Migration[] = [{
  version: 58,
  name: 'strategy_decision_evidence_v1',
  up: (db) => {
    db.exec(`
      CREATE TABLE strategy_decisions_v1 (
        decision_id       TEXT PRIMARY KEY CHECK (length(decision_id) = 64),
        profile_id        TEXT NOT NULL,
        run_id            TEXT NOT NULL UNIQUE,
        scheduled_for     INTEGER NOT NULL CHECK (scheduled_for >= 0),
        strategy_id       TEXT NOT NULL,
        strategy_version  TEXT NOT NULL,
        content_json      TEXT NOT NULL CHECK (
          json_valid(content_json) AND json_type(content_json) = 'object'
        ),
        content_hash      TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at        INTEGER NOT NULL CHECK (created_at >= 0),
        UNIQUE (profile_id, scheduled_for),
        UNIQUE (decision_id, profile_id)
      );
      CREATE INDEX strategy_decisions_v1_profile_time
        ON strategy_decisions_v1(profile_id, scheduled_for DESC, decision_id);

      CREATE TABLE decision_evidence_events_v1 (
        id            TEXT PRIMARY KEY CHECK (length(id) = 64),
        decision_id   TEXT NOT NULL,
        profile_id    TEXT NOT NULL,
        sequence      INTEGER NOT NULL CHECK (sequence >= 0),
        kind          TEXT NOT NULL CHECK (kind IN (
          'strategy_evaluated', 'risk_evaluated', 'execution_planned',
          'no_trade', 'stand_down', 'execution_submitted', 'execution_filled',
          'execution_refused', 'recovery'
        )),
        reason_code   TEXT,
        at            INTEGER NOT NULL CHECK (at >= 0),
        payload_json  TEXT NOT NULL CHECK (
          json_valid(payload_json) AND json_type(payload_json) = 'object'
        ),
        payload_hash  TEXT NOT NULL CHECK (length(payload_hash) = 64),
        UNIQUE (decision_id, sequence),
        FOREIGN KEY (decision_id, profile_id)
          REFERENCES strategy_decisions_v1(decision_id, profile_id)
      );
      CREATE INDEX decision_evidence_events_v1_profile_time
        ON decision_evidence_events_v1(profile_id, at DESC, id);

      CREATE TABLE wallet_decision_links_v1 (
        run_id       TEXT PRIMARY KEY REFERENCES wallet_decision_runs(id),
        decision_id  TEXT NOT NULL UNIQUE REFERENCES strategy_decisions_v1(decision_id)
      );

      CREATE TRIGGER strategy_decisions_v1_no_update
      BEFORE UPDATE ON strategy_decisions_v1
      BEGIN SELECT RAISE(ABORT, 'strategy decisions are immutable'); END;
      CREATE TRIGGER strategy_decisions_v1_no_delete
      BEFORE DELETE ON strategy_decisions_v1
      BEGIN SELECT RAISE(ABORT, 'strategy decisions are immutable'); END;
      CREATE TRIGGER decision_evidence_events_v1_no_update
      BEFORE UPDATE ON decision_evidence_events_v1
      BEGIN SELECT RAISE(ABORT, 'decision evidence events are append-only'); END;
      CREATE TRIGGER decision_evidence_events_v1_no_delete
      BEFORE DELETE ON decision_evidence_events_v1
      BEGIN SELECT RAISE(ABORT, 'decision evidence events are append-only'); END;
      CREATE TRIGGER wallet_decision_links_v1_no_update
      BEFORE UPDATE ON wallet_decision_links_v1
      BEGIN SELECT RAISE(ABORT, 'wallet decision links are immutable'); END;
      CREATE TRIGGER wallet_decision_links_v1_no_delete
      BEFORE DELETE ON wallet_decision_links_v1
      BEGIN SELECT RAISE(ABORT, 'wallet decision links are immutable'); END;
      CREATE TRIGGER wallet_decision_links_v1_same_profile
      BEFORE INSERT ON wallet_decision_links_v1
      WHEN NOT EXISTS (
        SELECT 1
        FROM wallet_decision_runs wallet, strategy_decisions_v1 decision
        WHERE wallet.id = NEW.run_id
          AND decision.decision_id = NEW.decision_id
          AND wallet.profile_id = decision.profile_id
      )
      BEGIN SELECT RAISE(ABORT, 'wallet decision link profile mismatch'); END;
    `);
  },
}];
