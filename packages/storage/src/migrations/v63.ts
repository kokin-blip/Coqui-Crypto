import type { Migration } from './types.js';

export const migrations63: readonly Migration[] = [{
  version: 63,
  name: 'connection_account_snapshots_v1',
  up(db) {
    db.exec(`
      CREATE TABLE connection_account_snapshots_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        connection_id TEXT NOT NULL REFERENCES profile_connections_v1(id),
        provider TEXT NOT NULL CHECK (provider = 'coinbase'),
        as_of INTEGER NOT NULL CHECK (as_of >= 0),
        complete INTEGER NOT NULL CHECK (complete IN (0,1)),
        health TEXT NOT NULL CHECK (health IN ('healthy','degraded','unavailable')),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      );
      CREATE INDEX connection_account_snapshots_v1_profile_time
        ON connection_account_snapshots_v1(profile_id, as_of DESC);
      CREATE INDEX connection_account_snapshots_v1_connection_time
        ON connection_account_snapshots_v1(connection_id, as_of DESC);
      CREATE TRIGGER connection_account_snapshots_v1_profile_guard
      BEFORE INSERT ON connection_account_snapshots_v1
      WHEN (SELECT profile_id FROM profile_connections_v1 WHERE id = NEW.connection_id)
        <> NEW.profile_id
      BEGIN SELECT RAISE(ABORT, 'connection snapshot profile mismatch'); END;
      CREATE TRIGGER connection_account_snapshots_v1_no_update
      BEFORE UPDATE ON connection_account_snapshots_v1
      BEGIN SELECT RAISE(ABORT, 'connection snapshots are immutable'); END;
      CREATE TRIGGER connection_account_snapshots_v1_no_delete
      BEFORE DELETE ON connection_account_snapshots_v1
      BEGIN SELECT RAISE(ABORT, 'connection snapshots are immutable'); END;
    `);
  },
}];
