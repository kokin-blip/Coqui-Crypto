import type { Migration } from './types.js';

/** Exact-decimal risk peaks; predecessor REAL values remain isolated for manual review. */
export const migrations32: readonly Migration[] = [{
  version: 32,
  name: 'exact_decimal_wallet_risk_state_v2',
  up: (db) => {
    db.exec(`
      CREATE TABLE wallet_risk_state_v2 (
        profile_id              TEXT PRIMARY KEY,
        stage                   TEXT NOT NULL,
        daily_peak_usd_text     TEXT,
        rolling_peak_usd_text   TEXT,
        lifetime_peak_usd_text  TEXT,
        hard_stopped            INTEGER NOT NULL CHECK (hard_stopped IN (0, 1)),
        reason                  TEXT,
        updated_at              INTEGER NOT NULL
      );

      CREATE TABLE wallet_risk_migration_exceptions (
        profile_id    TEXT PRIMARY KEY,
        reason        TEXT NOT NULL,
        recorded_at   INTEGER NOT NULL
      );

      INSERT OR IGNORE INTO wallet_risk_migration_exceptions (profile_id, reason, recorded_at)
      SELECT profile_id,
        'Legacy wallet risk peaks used SQLite REAL; exact decimal values require manual verification.',
        updated_at
      FROM wallet_risk_state;
    `);
  },
}];
