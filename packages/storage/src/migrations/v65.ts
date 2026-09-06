import type { Migration } from './types.js';

export const migrations65: readonly Migration[] = [{
  version: 65,
  name: 'venue_neutral_execution_plans_v1',
  up(db) {
    db.exec(`
      CREATE TABLE execution_plans_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        content_json TEXT NOT NULL CHECK (json_valid(content_json) AND json_type(content_json) = 'object'),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        UNIQUE(id, profile_id),
        FOREIGN KEY(decision_id, profile_id)
          REFERENCES strategy_decisions_v1(decision_id, profile_id)
      );
      CREATE INDEX execution_plans_v1_profile_time
        ON execution_plans_v1(profile_id, created_at DESC, id);

      CREATE TABLE execution_routes_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        plan_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('coinbase','robinhood_crypto')),
        idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) = 64),
        assumption_hash TEXT NOT NULL CHECK (length(assumption_hash) = 64),
        content_json TEXT NOT NULL CHECK (json_valid(content_json) AND json_type(content_json) = 'object'),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        FOREIGN KEY(plan_id, profile_id) REFERENCES execution_plans_v1(id, profile_id),
        FOREIGN KEY(decision_id, profile_id)
          REFERENCES strategy_decisions_v1(decision_id, profile_id)
      );
      CREATE INDEX execution_routes_v1_profile_connection
        ON execution_routes_v1(profile_id, connection_id, created_at DESC);

      CREATE TABLE execution_plan_evidence_links_v1 (
        plan_id TEXT PRIMARY KEY REFERENCES execution_plans_v1(id),
        event_id TEXT NOT NULL UNIQUE REFERENCES decision_evidence_events_v1(id)
      );

      CREATE TRIGGER execution_plans_v1_no_update BEFORE UPDATE ON execution_plans_v1
        BEGIN SELECT RAISE(ABORT, 'execution plans are immutable'); END;
      CREATE TRIGGER execution_plans_v1_no_delete BEFORE DELETE ON execution_plans_v1
        BEGIN SELECT RAISE(ABORT, 'execution plans are immutable'); END;
      CREATE TRIGGER execution_routes_v1_no_update BEFORE UPDATE ON execution_routes_v1
        BEGIN SELECT RAISE(ABORT, 'execution routes are immutable'); END;
      CREATE TRIGGER execution_routes_v1_no_delete BEFORE DELETE ON execution_routes_v1
        BEGIN SELECT RAISE(ABORT, 'execution routes are immutable'); END;
      CREATE TRIGGER execution_plan_evidence_links_v1_no_update
        BEFORE UPDATE ON execution_plan_evidence_links_v1
        BEGIN SELECT RAISE(ABORT, 'execution evidence links are immutable'); END;
      CREATE TRIGGER execution_plan_evidence_links_v1_no_delete
        BEFORE DELETE ON execution_plan_evidence_links_v1
        BEGIN SELECT RAISE(ABORT, 'execution evidence links are immutable'); END;
      CREATE TRIGGER execution_plan_evidence_links_v1_guard
        BEFORE INSERT ON execution_plan_evidence_links_v1
        WHEN NOT EXISTS (
          SELECT 1 FROM execution_plans_v1 plan
          JOIN decision_evidence_events_v1 event ON event.id = NEW.event_id
          WHERE plan.id = NEW.plan_id AND plan.decision_id = event.decision_id
            AND plan.profile_id = event.profile_id AND event.kind = 'execution_planned'
        )
        BEGIN SELECT RAISE(ABORT, 'execution plan evidence mismatch'); END;
    `);
  },
}];
