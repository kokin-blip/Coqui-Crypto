import type { Migration } from './types.js';

export const migrations66: readonly Migration[] = [{
  version: 66,
  name: 'renewable_scheduler_and_fenced_execution_leases_v1',
  up(db) {
    db.exec(`
      ALTER TABLE wallet_schedule_lease ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0
        CHECK (lease_generation >= 0);
      ALTER TABLE wallet_schedule_lease ADD COLUMN renewed_at INTEGER;
      ALTER TABLE wallet_schedule_lease ADD COLUMN cancellation_requested INTEGER NOT NULL DEFAULT 0
        CHECK (cancellation_requested IN (0,1));

      CREATE TABLE scheduler_lease_events_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        lease_generation INTEGER NOT NULL CHECK (lease_generation > 0),
        kind TEXT NOT NULL CHECK (kind IN ('acquired','renewed','released','lost','cancelled')),
        at INTEGER NOT NULL CHECK (at >= 0),
        detail_json TEXT NOT NULL CHECK (json_valid(detail_json))
      );
      CREATE INDEX scheduler_lease_events_v1_profile_time
        ON scheduler_lease_events_v1(profile_id, at DESC, id);

      CREATE TABLE execution_leases_v1 (
        profile_id TEXT PRIMARY KEY,
        owner_id TEXT,
        leased_until INTEGER,
        fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
        CHECK ((owner_id IS NULL) = (leased_until IS NULL))
      );
      CREATE TABLE execution_lease_events_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
        kind TEXT NOT NULL CHECK (kind IN ('acquired','renewed','released','lost')),
        at INTEGER NOT NULL CHECK (at >= 0),
        detail_json TEXT NOT NULL CHECK (json_valid(detail_json))
      );
      CREATE INDEX execution_lease_events_v1_profile_time
        ON execution_lease_events_v1(profile_id, at DESC, id);

      CREATE TRIGGER scheduler_lease_events_v1_no_update BEFORE UPDATE ON scheduler_lease_events_v1
        BEGIN SELECT RAISE(ABORT, 'scheduler lease events are append-only'); END;
      CREATE TRIGGER scheduler_lease_events_v1_no_delete BEFORE DELETE ON scheduler_lease_events_v1
        BEGIN SELECT RAISE(ABORT, 'scheduler lease events are append-only'); END;
      CREATE TRIGGER execution_lease_events_v1_no_update BEFORE UPDATE ON execution_lease_events_v1
        BEGIN SELECT RAISE(ABORT, 'execution lease events are append-only'); END;
      CREATE TRIGGER execution_lease_events_v1_no_delete BEFORE DELETE ON execution_lease_events_v1
        BEGIN SELECT RAISE(ABORT, 'execution lease events are append-only'); END;
    `);
  },
}];
