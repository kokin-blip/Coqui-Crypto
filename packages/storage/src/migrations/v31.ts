import type { Migration } from './types.js';

/** Coqui-native canonical instrument registry; legacy symbol-era mappings stay isolated. */
export const migrations31: readonly Migration[] = [{
  version: 31,
  name: 'canonical_instrument_provider_registry_v2',
  up: (db) => {
    db.exec(`
      CREATE TABLE canonical_instruments (
        venue         TEXT NOT NULL,
        product_id    TEXT NOT NULL,
        product_type  TEXT NOT NULL,
        symbol        TEXT NOT NULL,
        name          TEXT NOT NULL,
        base_asset    TEXT NOT NULL,
        quote_asset   TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (venue, product_id, product_type),
        CHECK (venue = 'coinbase'),
        CHECK (product_type = 'spot')
      );

      CREATE TABLE instrument_provider_mappings (
        provider           TEXT NOT NULL,
        provider_asset_id  TEXT NOT NULL,
        venue              TEXT NOT NULL,
        product_id         TEXT NOT NULL,
        product_type       TEXT NOT NULL,
        status             TEXT NOT NULL CHECK (status IN ('verified', 'ambiguous', 'retired')),
        platform           TEXT,
        network            TEXT,
        contract_address   TEXT,
        evidence_json      TEXT NOT NULL,
        verified_at        INTEGER,
        updated_at         INTEGER NOT NULL,
        PRIMARY KEY (provider, provider_asset_id),
        CHECK (provider IN ('coinbase', 'coingecko', 'coinmarketcap', 'coinpaprika')),
        FOREIGN KEY (venue, product_id, product_type)
          REFERENCES canonical_instruments (venue, product_id, product_type)
      );

      CREATE TABLE instrument_mapping_events_v2 (
        id                 TEXT PRIMARY KEY,
        provider           TEXT NOT NULL,
        provider_asset_id  TEXT NOT NULL,
        venue              TEXT NOT NULL,
        product_id         TEXT NOT NULL,
        product_type       TEXT NOT NULL,
        action             TEXT NOT NULL,
        status             TEXT NOT NULL,
        evidence_json      TEXT NOT NULL,
        at                 INTEGER NOT NULL,
        FOREIGN KEY (venue, product_id, product_type)
          REFERENCES canonical_instruments (venue, product_id, product_type)
      );

      CREATE TABLE canonical_mapping_migration_exceptions (
        source_table       TEXT NOT NULL,
        source_key         TEXT NOT NULL,
        reason             TEXT NOT NULL,
        recorded_at        INTEGER NOT NULL,
        PRIMARY KEY (source_table, source_key)
      );

      CREATE INDEX idx_instrument_provider_mappings_identity
        ON instrument_provider_mappings (venue, product_id, product_type, provider);
      CREATE INDEX idx_instrument_mapping_events_identity_at
        ON instrument_mapping_events_v2 (venue, product_id, product_type, at DESC);

      INSERT OR IGNORE INTO canonical_mapping_migration_exceptions
        (source_table, source_key, reason, recorded_at)
      SELECT 'canonical_assets', id,
        'Legacy canonical asset lacks a complete venue/product/product-type identity; manual verification required.',
        updated_at
      FROM canonical_assets;

      INSERT OR IGNORE INTO canonical_mapping_migration_exceptions
        (source_table, source_key, reason, recorded_at)
      SELECT 'asset_provider_mappings', provider || ':' || provider_asset_id,
        'Legacy provider mapping is tied to a symbol-era canonical asset; manual verification required.',
        updated_at
      FROM asset_provider_mappings;
    `);
  },
}];
