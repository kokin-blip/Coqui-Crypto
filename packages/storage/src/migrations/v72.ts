import type { Migration } from './types.js';

export const migrations72: readonly Migration[] = [{
  version: 72,
  name: 'connection_and_unified_portfolio_snapshots_v2',
  up(db) {
    db.exec(`
      CREATE TABLE connection_account_snapshots_v2 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64), profile_id TEXT NOT NULL,
        connection_id TEXT NOT NULL REFERENCES profile_connections_v2(id),
        provider TEXT NOT NULL CHECK (provider IN ('coinbase','robinhood_crypto')),
        as_of INTEGER NOT NULL CHECK (as_of >= 0), complete INTEGER NOT NULL CHECK (complete IN (0,1)),
        health TEXT NOT NULL CHECK (health IN ('healthy','degraded','unavailable')),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      );
      CREATE INDEX connection_account_snapshots_v2_profile_time
        ON connection_account_snapshots_v2(profile_id, as_of DESC);
      CREATE INDEX connection_account_snapshots_v2_connection_time
        ON connection_account_snapshots_v2(connection_id, as_of DESC);
      CREATE TRIGGER connection_account_snapshots_v2_no_update BEFORE UPDATE ON connection_account_snapshots_v2
      BEGIN SELECT RAISE(ABORT, 'connection snapshots v2 are immutable'); END;
      CREATE TRIGGER connection_account_snapshots_v2_no_delete BEFORE DELETE ON connection_account_snapshots_v2
      BEGIN SELECT RAISE(ABORT, 'connection snapshots v2 are immutable'); END;
      CREATE TRIGGER connection_account_snapshots_v2_profile_guard BEFORE INSERT ON connection_account_snapshots_v2
      WHEN (SELECT profile_id FROM profile_connections_v2 WHERE id = NEW.connection_id) <> NEW.profile_id
        OR (SELECT provider FROM profile_connections_v2 WHERE id = NEW.connection_id) <> NEW.provider
      BEGIN SELECT RAISE(ABORT, 'connection snapshot v2 ownership mismatch'); END;

      CREATE TABLE unified_portfolio_snapshots_v2 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64), profile_id TEXT NOT NULL,
        as_of INTEGER NOT NULL CHECK (as_of >= 0), complete INTEGER NOT NULL CHECK (complete IN (0,1)),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      );
      CREATE INDEX unified_portfolio_snapshots_v2_profile_time
        ON unified_portfolio_snapshots_v2(profile_id, complete, as_of DESC);
      CREATE TABLE unified_portfolio_snapshot_sources_v2 (
        unified_snapshot_id TEXT NOT NULL REFERENCES unified_portfolio_snapshots_v2(id),
        connection_snapshot_id TEXT NOT NULL REFERENCES connection_account_snapshots_v2(id),
        PRIMARY KEY(unified_snapshot_id, connection_snapshot_id)
      );
      CREATE TRIGGER unified_portfolio_snapshots_v2_no_update BEFORE UPDATE ON unified_portfolio_snapshots_v2
      BEGIN SELECT RAISE(ABORT, 'unified portfolio snapshots v2 are immutable'); END;
      CREATE TRIGGER unified_portfolio_snapshots_v2_no_delete BEFORE DELETE ON unified_portfolio_snapshots_v2
      BEGIN SELECT RAISE(ABORT, 'unified portfolio snapshots v2 are immutable'); END;
      CREATE TRIGGER unified_portfolio_snapshot_sources_v2_no_update BEFORE UPDATE ON unified_portfolio_snapshot_sources_v2
      BEGIN SELECT RAISE(ABORT, 'unified portfolio source links v2 are immutable'); END;
      CREATE TRIGGER unified_portfolio_snapshot_sources_v2_no_delete BEFORE DELETE ON unified_portfolio_snapshot_sources_v2
      BEGIN SELECT RAISE(ABORT, 'unified portfolio source links v2 are immutable'); END;
      CREATE TRIGGER unified_portfolio_snapshot_sources_v2_profile_guard BEFORE INSERT ON unified_portfolio_snapshot_sources_v2
      WHEN (SELECT profile_id FROM unified_portfolio_snapshots_v2 WHERE id = NEW.unified_snapshot_id) <>
           (SELECT profile_id FROM connection_account_snapshots_v2 WHERE id = NEW.connection_snapshot_id)
      BEGIN SELECT RAISE(ABORT, 'unified portfolio source v2 ownership mismatch'); END;

      CREATE TABLE portfolio_valuation_observations_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64), profile_id TEXT NOT NULL,
        unified_snapshot_id TEXT NOT NULL UNIQUE REFERENCES unified_portfolio_snapshots_v2(id),
        observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
        total_value_usd_text TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      );
      CREATE INDEX portfolio_valuation_observations_v1_profile_time
        ON portfolio_valuation_observations_v1(profile_id, observed_at);
      CREATE TRIGGER portfolio_valuation_observations_v1_no_update BEFORE UPDATE ON portfolio_valuation_observations_v1
      BEGIN SELECT RAISE(ABORT, 'portfolio valuation observations are immutable'); END;
      CREATE TRIGGER portfolio_valuation_observations_v1_no_delete BEFORE DELETE ON portfolio_valuation_observations_v1
      BEGIN SELECT RAISE(ABORT, 'portfolio valuation observations are immutable'); END;
    `);
  },
}];
