import type { Migration } from './types.js';

/** Predecessor migrations 18-23, preserved at their original versions. */
export const migrations18To23: readonly Migration[] = [
  {
    version: 18,
    name: 'wallet_scheduler_and_execution_journal',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS wallet_schedule_lease (
          profile_id    TEXT PRIMARY KEY,
          owner_id      TEXT,
          leased_until  INTEGER,
          next_run_at   INTEGER NOT NULL,
          last_run_at   INTEGER,
          state         TEXT NOT NULL,
          error         TEXT
        );

        CREATE TABLE IF NOT EXISTS wallet_risk_state (
          profile_id       TEXT PRIMARY KEY,
          stage            TEXT NOT NULL,
          daily_peak_usd   REAL,
          rolling_peak_usd REAL,
          lifetime_peak_usd REAL,
          hard_stopped     INTEGER NOT NULL DEFAULT 0,
          reason           TEXT,
          updated_at       INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS wallet_execution_journal (
          id           TEXT PRIMARY KEY,
          profile_id   TEXT NOT NULL,
          run_id       TEXT NOT NULL,
          at           INTEGER NOT NULL,
          kind         TEXT NOT NULL,
          status       TEXT NOT NULL,
          detail_json  TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_execution_run_kind
          ON wallet_execution_journal (run_id, kind);
        CREATE INDEX IF NOT EXISTS idx_wallet_execution_profile_at
          ON wallet_execution_journal (profile_id, at DESC);

        CREATE TABLE IF NOT EXISTS paper_orders (
          id            TEXT PRIMARY KEY,
          profile_id    TEXT NOT NULL,
          run_id        TEXT NOT NULL,
          asset_id      TEXT NOT NULL,
          side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
          quantity      REAL NOT NULL,
          notional_usd  REAL NOT NULL,
          state         TEXT NOT NULL CHECK (state IN ('submitted', 'filled', 'rejected')),
          reason        TEXT,
          created_at    INTEGER NOT NULL,
          updated_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS paper_fills (
          id            TEXT PRIMARY KEY,
          order_id      TEXT NOT NULL,
          profile_id    TEXT NOT NULL,
          filled_at     INTEGER NOT NULL,
          quantity      REAL NOT NULL,
          price_usd     REAL NOT NULL,
          fee_usd       REAL NOT NULL,
          FOREIGN KEY (order_id) REFERENCES paper_orders(id)
        );

        CREATE INDEX IF NOT EXISTS idx_paper_orders_profile_created
          ON paper_orders (profile_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_paper_fills_profile_filled
          ON paper_fills (profile_id, filled_at DESC);
      `);
    },
  },
  {
    version: 19,
    name: 'timestamped_market_bars_v2',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS market_bars_v2 (
          source             TEXT    NOT NULL,
          asset_id           TEXT    NOT NULL,
          provider_asset_id  TEXT    NOT NULL,
          interval           TEXT    NOT NULL,
          start_time_ms      INTEGER NOT NULL,
          end_time_ms        INTEGER NOT NULL,
          open_text          TEXT    NOT NULL,
          high_text          TEXT    NOT NULL,
          low_text           TEXT    NOT NULL,
          close_text         TEXT    NOT NULL,
          volume_text        TEXT,
          is_complete        INTEGER NOT NULL CHECK (is_complete IN (0, 1)),
          quality            TEXT    NOT NULL CHECK (
            quality IN ('reported_ohlc', 'close_only_legacy', 'synthetic_ohlc')
          ),
          retrieved_at_ms    INTEGER NOT NULL,
          PRIMARY KEY (source, asset_id, interval, start_time_ms)
        );

        CREATE INDEX IF NOT EXISTS idx_market_bars_v2_asset_interval_time
          ON market_bars_v2 (asset_id, interval, start_time_ms);
      `);
    },
  },
  {
    version: 20,
    name: 'paper_order_events_and_ledger',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS paper_orders_v2 (
          id                 TEXT PRIMARY KEY,
          profile_id         TEXT NOT NULL,
          run_id             TEXT NOT NULL,
          asset_id           TEXT NOT NULL,
          product_id         TEXT NOT NULL,
          side               TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
          requested_qty_text TEXT NOT NULL,
          requested_usd_text TEXT NOT NULL,
          state              TEXT NOT NULL CHECK (
            state IN ('created', 'accepted', 'partially_filled', 'filled', 'cancelled', 'expired', 'rejected')
          ),
          reason             TEXT,
          created_at         INTEGER NOT NULL,
          updated_at         INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS paper_order_events (
          id          TEXT PRIMARY KEY,
          order_id    TEXT NOT NULL,
          profile_id  TEXT NOT NULL,
          sequence    INTEGER NOT NULL,
          state       TEXT NOT NULL,
          at          INTEGER NOT NULL,
          detail_json TEXT NOT NULL,
          UNIQUE (order_id, sequence),
          FOREIGN KEY (order_id) REFERENCES paper_orders_v2(id)
        );

        CREATE TABLE IF NOT EXISTS paper_fills_v2 (
          id             TEXT PRIMARY KEY,
          order_id       TEXT NOT NULL,
          profile_id     TEXT NOT NULL,
          quantity_text  TEXT NOT NULL,
          price_usd_text TEXT NOT NULL,
          fee_usd_text   TEXT NOT NULL,
          filled_at      INTEGER NOT NULL,
          FOREIGN KEY (order_id) REFERENCES paper_orders_v2(id)
        );

        CREATE TABLE IF NOT EXISTS paper_ledger_entries (
          id              TEXT PRIMARY KEY,
          profile_id      TEXT NOT NULL,
          run_id          TEXT NOT NULL,
          fill_id         TEXT,
          account         TEXT NOT NULL CHECK (account IN ('cash', 'inventory', 'cost', 'opening')),
          asset_id        TEXT,
          amount_usd_text TEXT NOT NULL,
          quantity_text   TEXT,
          at              INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS paper_balances (
          profile_id    TEXT NOT NULL,
          asset_id      TEXT NOT NULL,
          quantity_text TEXT NOT NULL,
          updated_at    INTEGER NOT NULL,
          PRIMARY KEY (profile_id, asset_id)
        );

        CREATE TABLE IF NOT EXISTS paper_product_rules (
          product_id          TEXT PRIMARY KEY,
          base_increment_text TEXT NOT NULL,
          quote_increment_text TEXT NOT NULL,
          base_min_size_text  TEXT NOT NULL,
          quote_min_size_text TEXT NOT NULL,
          source              TEXT NOT NULL,
          retrieved_at        INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_paper_orders_v2_profile_created
          ON paper_orders_v2 (profile_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_paper_order_events_order_sequence
          ON paper_order_events (order_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_paper_ledger_profile_at
          ON paper_ledger_entries (profile_id, at);
      `);
    },
  },
  {
    version: 21,
    name: 'wallet_risk_profiles_and_decision_runs',
    up: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_wallet_execution_run_kind;

        CREATE INDEX IF NOT EXISTS idx_wallet_execution_run_at
          ON wallet_execution_journal (run_id, at);

        CREATE TABLE IF NOT EXISTS wallet_risk_profiles (
          profile_id   TEXT PRIMARY KEY,
          version      TEXT NOT NULL,
          profile_json TEXT NOT NULL,
          updated_at   INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS wallet_decision_runs (
          id               TEXT PRIMARY KEY,
          profile_id       TEXT NOT NULL,
          scheduled_for    INTEGER NOT NULL,
          strategy_version TEXT NOT NULL,
          snapshot_hash    TEXT NOT NULL,
          snapshot_json    TEXT NOT NULL,
          status           TEXT NOT NULL CHECK (
            status IN ('prepared', 'applied', 'completed', 'failed')
          ),
          created_at       INTEGER NOT NULL,
          updated_at       INTEGER NOT NULL,
          error            TEXT,
          UNIQUE (profile_id, scheduled_for, strategy_version)
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_decision_profile_scheduled
          ON wallet_decision_runs (profile_id, scheduled_for DESC);
      `);
    },
  },
  {
    version: 22,
    name: 'canonical_asset_registry',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS canonical_assets (
          id          TEXT PRIMARY KEY,
          symbol      TEXT NOT NULL,
          name        TEXT NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS asset_provider_mappings (
          provider          TEXT NOT NULL,
          provider_asset_id TEXT NOT NULL,
          canonical_asset_id TEXT NOT NULL,
          status            TEXT NOT NULL CHECK (status IN ('verified', 'ambiguous', 'retired')),
          updated_at        INTEGER NOT NULL,
          PRIMARY KEY (provider, provider_asset_id),
          FOREIGN KEY (canonical_asset_id) REFERENCES canonical_assets(id)
        );

        CREATE TABLE IF NOT EXISTS asset_aliases (
          alias              TEXT NOT NULL,
          canonical_asset_id TEXT NOT NULL,
          source             TEXT NOT NULL,
          updated_at         INTEGER NOT NULL,
          PRIMARY KEY (alias, source),
          FOREIGN KEY (canonical_asset_id) REFERENCES canonical_assets(id)
        );
      `);
    },
  },
  {
    version: 23,
    name: 'staged_coinbase_imports',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS coinbase_import_jobs (
          id                    TEXT PRIMARY KEY,
          profile_id            TEXT NOT NULL,
          status                TEXT NOT NULL CHECK (
            status IN ('staging', 'needs_resolution', 'promoted', 'failed', 'cancelled')
          ),
          cost_basis_method     TEXT NOT NULL,
          started_at            INTEGER NOT NULL,
          completed_at          INTEGER,
          discrepancy_count     INTEGER NOT NULL DEFAULT 0,
          error                 TEXT
        );

        CREATE TABLE IF NOT EXISTS coinbase_import_stage_lots (
          job_id    TEXT NOT NULL,
          row_id    TEXT NOT NULL,
          row_json  TEXT NOT NULL,
          PRIMARY KEY (job_id, row_id),
          FOREIGN KEY (job_id) REFERENCES coinbase_import_jobs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS coinbase_import_stage_disposals (
          job_id    TEXT NOT NULL,
          row_id    TEXT NOT NULL,
          row_json  TEXT NOT NULL,
          PRIMARY KEY (job_id, row_id),
          FOREIGN KEY (job_id) REFERENCES coinbase_import_jobs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS coinbase_import_discrepancies (
          id              TEXT PRIMARY KEY,
          job_id          TEXT NOT NULL,
          currency        TEXT NOT NULL,
          kind            TEXT NOT NULL,
          quantity_text   TEXT NOT NULL,
          resolution      TEXT,
          resolved_at     INTEGER,
          FOREIGN KEY (job_id) REFERENCES coinbase_import_jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_coinbase_import_profile_started
          ON coinbase_import_jobs (profile_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_coinbase_discrepancy_job
          ON coinbase_import_discrepancies (job_id);
      `);
    },
  },
];
