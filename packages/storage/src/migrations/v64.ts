import type { Migration } from './types.js';

export const migrations64: readonly Migration[] = [{
  version: 64,
  name: 'unified_portfolio_snapshots_v1',
  up(db) {
    db.exec(`
      CREATE TABLE unified_portfolio_snapshots_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        as_of INTEGER NOT NULL CHECK (as_of >= 0),
        complete INTEGER NOT NULL CHECK (complete IN (0,1)),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      );
      CREATE INDEX unified_portfolio_snapshots_v1_profile_time
        ON unified_portfolio_snapshots_v1(profile_id, as_of DESC);
      CREATE TABLE unified_portfolio_snapshot_connections_v1 (
        unified_snapshot_id TEXT NOT NULL REFERENCES unified_portfolio_snapshots_v1(id),
        connection_snapshot_id TEXT NOT NULL REFERENCES connection_account_snapshots_v1(id),
        PRIMARY KEY(unified_snapshot_id, connection_snapshot_id)
      );
      CREATE TRIGGER unified_portfolio_snapshots_v1_no_update
      BEFORE UPDATE ON unified_portfolio_snapshots_v1
      BEGIN SELECT RAISE(ABORT, 'unified portfolio snapshots are immutable'); END;
      CREATE TRIGGER unified_portfolio_snapshots_v1_no_delete
      BEFORE DELETE ON unified_portfolio_snapshots_v1
      BEGIN SELECT RAISE(ABORT, 'unified portfolio snapshots are immutable'); END;
      CREATE TRIGGER unified_portfolio_snapshot_connections_v1_no_update
      BEFORE UPDATE ON unified_portfolio_snapshot_connections_v1
      BEGIN SELECT RAISE(ABORT, 'unified portfolio links are immutable'); END;
      CREATE TRIGGER unified_portfolio_snapshot_connections_v1_profile_guard
      BEFORE INSERT ON unified_portfolio_snapshot_connections_v1
      WHEN (SELECT profile_id FROM unified_portfolio_snapshots_v1
              WHERE id = NEW.unified_snapshot_id) <>
           (SELECT profile_id FROM connection_account_snapshots_v1
              WHERE id = NEW.connection_snapshot_id)
      BEGIN SELECT RAISE(ABORT, 'unified portfolio source profile mismatch'); END;
      CREATE TRIGGER unified_portfolio_snapshot_connections_v1_no_delete
      BEFORE DELETE ON unified_portfolio_snapshot_connections_v1
      BEGIN SELECT RAISE(ABORT, 'unified portfolio links are immutable'); END;
    `);
  },
}];
