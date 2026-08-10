import type { Migration } from './types.js';

/** First Coqui-native schema: exact decimals and canonical product identities. */
export const migrations29: readonly Migration[] = [
  {
    version: 29,
    name: 'canonical_decimal_portfolio_v2',
    up: (db) => {
      db.exec(`
        CREATE TABLE tax_lots_v2 (
          id             TEXT PRIMARY KEY,
          venue          TEXT NOT NULL CHECK (venue = 'coinbase'),
          product_id     TEXT NOT NULL,
          product_type   TEXT NOT NULL CHECK (product_type = 'spot'),
          symbol         TEXT NOT NULL,
          asset_name     TEXT NOT NULL,
          base_asset     TEXT NOT NULL,
          quote_asset    TEXT NOT NULL CHECK (quote_asset = 'USD'),
          coingecko_id   TEXT,
          quantity_text  TEXT NOT NULL,
          remaining_text TEXT NOT NULL,
          cost_usd_text  TEXT NOT NULL,
          acquired_at    INTEGER NOT NULL,
          source         TEXT NOT NULL CHECK (source IN ('coinbase', 'manual', 'onchain')),
          external_id    TEXT,
          UNIQUE (venue, product_id, product_type, id)
        );

        CREATE INDEX idx_tax_lots_v2_instrument
          ON tax_lots_v2 (venue, product_id, product_type);
        CREATE INDEX idx_tax_lots_v2_source_external
          ON tax_lots_v2 (source, external_id);

        CREATE TABLE disposals_v2 (
          id                    TEXT PRIMARY KEY,
          venue                 TEXT NOT NULL CHECK (venue = 'coinbase'),
          product_id            TEXT NOT NULL,
          product_type          TEXT NOT NULL CHECK (product_type = 'spot'),
          symbol                TEXT NOT NULL,
          asset_name            TEXT NOT NULL,
          base_asset            TEXT NOT NULL,
          quote_asset           TEXT NOT NULL CHECK (quote_asset = 'USD'),
          coingecko_id          TEXT,
          quantity_text         TEXT NOT NULL,
          proceeds_usd_text     TEXT NOT NULL,
          cost_basis_usd_text   TEXT NOT NULL,
          realized_pnl_usd_text TEXT NOT NULL,
          long_term             INTEGER NOT NULL CHECK (long_term IN (0, 1)),
          disposed_at           INTEGER NOT NULL,
          method                TEXT NOT NULL CHECK (method IN ('fifo', 'lifo', 'hifo', 'average')),
          source                TEXT NOT NULL CHECK (source IN ('coinbase', 'manual', 'onchain'))
        );

        CREATE INDEX idx_disposals_v2_instrument_at
          ON disposals_v2 (venue, product_id, product_type, disposed_at);
        CREATE INDEX idx_disposals_v2_source ON disposals_v2 (source);

        CREATE TABLE allocation_targets_v2 (
          venue        TEXT NOT NULL CHECK (venue = 'coinbase'),
          product_id   TEXT NOT NULL,
          product_type TEXT NOT NULL CHECK (product_type = 'spot'),
          weight       REAL NOT NULL CHECK (weight >= 0 AND weight <= 1),
          PRIMARY KEY (venue, product_id, product_type)
        );

        CREATE TABLE portfolio_snapshots_v2 (
          at                    INTEGER PRIMARY KEY,
          value_usd_text        TEXT NOT NULL,
          cost_usd_text         TEXT NOT NULL,
          realized_pnl_usd_text TEXT NOT NULL
        );

        CREATE TABLE portfolio_migration_exceptions (
          id           TEXT PRIMARY KEY,
          legacy_table TEXT NOT NULL,
          legacy_id    TEXT NOT NULL,
          reason       TEXT NOT NULL,
          resolved_at  INTEGER,
          resolution   TEXT
        );

        INSERT INTO portfolio_migration_exceptions (id, legacy_table, legacy_id, reason)
        SELECT 'tax_lots:' || id, 'tax_lots', id,
               'Legacy REAL-valued lot requires explicit canonical decimal review.'
        FROM tax_lots;

        INSERT INTO portfolio_migration_exceptions (id, legacy_table, legacy_id, reason)
        SELECT 'disposals:' || id, 'disposals', id,
               'Legacy REAL-valued disposal requires explicit canonical decimal review.'
        FROM disposals;

        INSERT INTO portfolio_migration_exceptions (id, legacy_table, legacy_id, reason)
        SELECT 'allocation_targets:' || asset_id, 'allocation_targets', asset_id,
               'Legacy target lacks a canonical venue product identity.'
        FROM allocation_targets;

        INSERT INTO portfolio_migration_exceptions (id, legacy_table, legacy_id, reason)
        SELECT 'portfolio_snapshots:' || at, 'portfolio_snapshots', CAST(at AS TEXT),
               'Legacy REAL-valued snapshot requires explicit decimal review.'
        FROM portfolio_snapshots;
      `);
    },
  },
];
