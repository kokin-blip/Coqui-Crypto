import type { Migration } from './types.js';

/** Profile-scoped display bars; never part of the decision-bar archive. */
export const migrations53: readonly Migration[] = [{
  version: 53,
  name: 'profile_display_bar_cache_v1',
  up: (db) => {
    db.exec(`
      CREATE TABLE display_market_bars_v1 (
        profile_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        interval TEXT NOT NULL CHECK (interval IN ('1m', '5m', '15m', '1h', '6h', '1d')),
        start_time_ms INTEGER NOT NULL CHECK (start_time_ms >= 0),
        end_time_ms INTEGER NOT NULL CHECK (end_time_ms > start_time_ms),
        open_text TEXT NOT NULL,
        high_text TEXT NOT NULL,
        low_text TEXT NOT NULL,
        close_text TEXT NOT NULL,
        volume_text TEXT,
        retrieved_at_ms INTEGER NOT NULL CHECK (retrieved_at_ms >= 0),
        expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= retrieved_at_ms),
        source TEXT NOT NULL DEFAULT 'coinbase_exchange_rest'
          CHECK (source = 'coinbase_exchange_rest'),
        informational_only INTEGER NOT NULL DEFAULT 1 CHECK (informational_only = 1),
        decision_eligible INTEGER NOT NULL DEFAULT 0 CHECK (decision_eligible = 0),
        PRIMARY KEY (profile_id, product_id, interval, start_time_ms)
      );
      CREATE INDEX display_market_bars_v1_expiry
        ON display_market_bars_v1(profile_id, expires_at_ms);
      CREATE INDEX display_market_bars_v1_lookup
        ON display_market_bars_v1(profile_id, product_id, interval, start_time_ms);
    `);
  },
}];
