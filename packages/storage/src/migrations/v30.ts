import type { Migration } from './types.js';

/** Surface predecessor market rows that do not carry canonical venue identity. */
export const migrations30: readonly Migration[] = [
  {
    version: 30,
    name: 'market_data_identity_exceptions',
    up: (db) => {
      db.exec(`
        CREATE TABLE market_data_migration_exceptions (
          id           TEXT PRIMARY KEY,
          legacy_table TEXT NOT NULL,
          legacy_key   TEXT NOT NULL,
          reason       TEXT NOT NULL,
          resolved_at  INTEGER,
          resolution   TEXT
        );

        INSERT INTO market_data_migration_exceptions
          (id, legacy_table, legacy_key, reason)
        SELECT
          'market_bars_v2:' || source || ':' || asset_id || ':' || interval || ':' || start_time_ms,
          'market_bars_v2',
          source || ':' || asset_id || ':' || interval || ':' || start_time_ms,
          'Legacy market bar lacks canonical venue/product/product-type identity.'
        FROM market_bars_v2
        WHERE asset_id NOT LIKE 'coinbase|spot|%';

        INSERT INTO market_data_migration_exceptions
          (id, legacy_table, legacy_key, reason)
        SELECT
          'daily_closes:' || asset_id || ':' || time_s,
          'daily_closes',
          asset_id || ':' || time_s,
          'Legacy daily close lacks canonical venue/product/product-type identity.'
        FROM daily_closes
        WHERE asset_id NOT LIKE 'coinbase|spot|%';
      `);
    },
  },
];
