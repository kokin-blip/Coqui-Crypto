import type { Migration } from './types.js';

/** Immutable full-product observations for forward point-in-time universe coverage. */
export const migrations33: readonly Migration[] = [{
  version: 33,
  name: 'point_in_time_universe_snapshots',
  up: (db) => {
    db.exec(`
      CREATE TABLE universe_snapshots (
        id                      TEXT PRIMARY KEY,
        source                  TEXT NOT NULL CHECK (source = 'coinbase-products'),
        observed_at_ms          INTEGER NOT NULL UNIQUE,
        effective_from_day_key  TEXT NOT NULL,
        snapshot_hash           TEXT NOT NULL UNIQUE,
        product_count           INTEGER NOT NULL,
        products_json           TEXT NOT NULL,
        created_at_ms           INTEGER NOT NULL
      );

      CREATE TABLE universe_product_observations (
        snapshot_id        TEXT NOT NULL,
        venue              TEXT NOT NULL,
        product_id         TEXT NOT NULL,
        product_type       TEXT NOT NULL,
        base_asset         TEXT NOT NULL,
        quote_asset        TEXT NOT NULL,
        status             TEXT NOT NULL,
        trading_disabled   INTEGER CHECK (trading_disabled IN (0, 1)),
        cancel_only        INTEGER CHECK (cancel_only IN (0, 1)),
        limit_only         INTEGER CHECK (limit_only IN (0, 1)),
        post_only          INTEGER CHECK (post_only IN (0, 1)),
        base_increment_text  TEXT,
        quote_increment_text TEXT,
        min_market_funds_text TEXT,
        PRIMARY KEY (snapshot_id, venue, product_id, product_type),
        FOREIGN KEY (snapshot_id) REFERENCES universe_snapshots(id)
      );

      CREATE INDEX idx_universe_snapshots_effective_observed
        ON universe_snapshots (effective_from_day_key, observed_at_ms DESC);
      CREATE INDEX idx_universe_products_identity
        ON universe_product_observations (venue, product_id, product_type, snapshot_id);
    `);
  },
}];
