import type { Migration } from './types.js';

/** Predecessor migrations 9-17, preserved at their original versions. */
export const migrations9To17: readonly Migration[] = [
  {
    version: 9,
    name: 'kokintrader_lot_ledger',
    // The pivot's lot-accurate ledger (CLAUDE.md §5): tax_lots is the source of
    // truth for quantity + cost basis; disposals are the realized tax events;
    // allocation_targets holds the user's target mix. The AssetRef is denormalized
    // onto each row so a lot/disposal renders correctly on its own. The earlier
    // memecoin tables (1–8) are untouched and retire separately.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tax_lots (
          id                  TEXT PRIMARY KEY,
          asset_id            TEXT NOT NULL,
          asset_symbol        TEXT NOT NULL,
          asset_name          TEXT NOT NULL,
          coinbase_product_id TEXT,
          coingecko_id        TEXT,
          quantity            REAL NOT NULL,
          remaining           REAL NOT NULL,
          cost_usd            REAL NOT NULL,
          acquired_at         INTEGER NOT NULL,
          source              TEXT NOT NULL,
          external_id         TEXT
        );

        CREATE TABLE IF NOT EXISTS disposals (
          id                  TEXT PRIMARY KEY,
          asset_id            TEXT NOT NULL,
          asset_symbol        TEXT NOT NULL,
          asset_name          TEXT NOT NULL,
          coinbase_product_id TEXT,
          coingecko_id        TEXT,
          quantity            REAL NOT NULL,
          proceeds_usd        REAL NOT NULL,
          cost_basis_usd      REAL NOT NULL,
          realized_pnl_usd    REAL NOT NULL,
          long_term           INTEGER NOT NULL,
          disposed_at         INTEGER NOT NULL,
          method              TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS allocation_targets (
          asset_id TEXT PRIMARY KEY,
          weight   REAL NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tax_lots_asset ON tax_lots (asset_id);
        CREATE INDEX IF NOT EXISTS idx_tax_lots_open ON tax_lots (remaining);
        CREATE INDEX IF NOT EXISTS idx_tax_lots_external ON tax_lots (external_id);
        CREATE INDEX IF NOT EXISTS idx_disposals_asset ON disposals (asset_id);
        CREATE INDEX IF NOT EXISTS idx_disposals_disposed_at ON disposals (disposed_at);
      `);
    },
  },
  {
    version: 10,
    name: 'disposal_source',
    // Tag each disposal with how it entered the ledger ('manual' vs a synced
    // source like 'coinbase') so a re-sync can replace synced disposals without
    // clobbering manually-recorded ones. Existing rows default to 'manual'.
    up: (db) => {
      db.exec(`ALTER TABLE disposals ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';`);
    },
  },
  {
    version: 11,
    name: 'portfolio_snapshots',
    // Forward-only daily value history (CLAUDE.md §5): one row per day holding
    // the live market value + cost basis + cumulative realized P&L of the lot
    // ledger at that moment. `at` is a day-start (UTC midnight) so re-recording
    // within a day upserts the latest value rather than appending. Lets the
    // Performance view chart value over time and split growth from contributions.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
          at               INTEGER PRIMARY KEY,
          value_usd        REAL NOT NULL,
          cost_usd         REAL NOT NULL,
          realized_pnl_usd REAL NOT NULL DEFAULT 0
        );
      `);
    },
  },
  {
    version: 12,
    name: 'drop_memecoin_tables',
    // Housekeeping: the pivot to kokincrypto retired the memecoin engine, but its
    // tables (migrations 1–6) lingered as empty/inert schema. Drop them now. The
    // app DB keeps its original filename for local-data continuity. These legacy
    // tables never held kokincrypto portfolio data; old memecoin data lives on
    // `archive/memecoin`.
    // We KEEP `holdings` (migration 8) as append-only history and the lot ledger.
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS wallet_hits;
        DROP TABLE IF EXISTS tracked_wallets;
        DROP TABLE IF EXISTS sim_equity;
        DROP TABLE IF EXISTS sim_positions;
        DROP TABLE IF EXISTS sim_accounts;
        DROP TABLE IF EXISTS signals;
        DROP TABLE IF EXISTS token_history;
        DROP TABLE IF EXISTS risk_reports;
        DROP TABLE IF EXISTS trades;
        DROP TABLE IF EXISTS deployers;
        DROP TABLE IF EXISTS tokens;
      `);
    },
  },
  {
    version: 13,
    name: 'user_disclaimer_acceptances',
    // Local audit record for safety/compliance acknowledgements. Desktop builds
    // do not always have a server user, IP, or browser UA, so those fields are
    // nullable while preserving the web-ready shape.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_disclaimer_acceptances (
          id                 TEXT PRIMARY KEY,
          user_id            TEXT,
          disclaimer_version TEXT NOT NULL,
          accepted_at        INTEGER NOT NULL,
          ip_address         TEXT,
          user_agent         TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_disclaimer_acceptances_user ON user_disclaimer_acceptances (user_id);
        CREATE INDEX IF NOT EXISTS idx_disclaimer_acceptances_version ON user_disclaimer_acceptances (disclaimer_version);
        CREATE INDEX IF NOT EXISTS idx_disclaimer_acceptances_accepted_at ON user_disclaimer_acceptances (accepted_at);
      `);
    },
  },
  {
    version: 14,
    name: 'daily_closes',
    // Deep daily-close history cache (Coinbase paginated fetch). One row per
    // asset per UTC day; refreshes only pull the missing tail, so years of
    // backtest history cost one cheap delta request per day per coin.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS daily_closes (
          asset_id TEXT    NOT NULL,
          time_s   INTEGER NOT NULL,
          close    REAL    NOT NULL,
          PRIMARY KEY (asset_id, time_s)
        );
      `);
    },
  },
  {
    version: 15,
    name: 'evidence_snapshots',
    // Daily trail of the scoreboard's honest verdicts (DSR/PSR, walk-forward,
    // leader vs benchmarks) — the visible path toward the LIVE evidence gate.
    // One row per day, upserted on each cadence-7 scoreboard run.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS evidence_snapshots (
          day_ms          INTEGER PRIMARY KEY,
          leader          TEXT    NOT NULL,
          dsr             REAL,
          psr             REAL,
          sig_verdict     TEXT    NOT NULL,
          wf_verdict      TEXT    NOT NULL,
          leader_sortino  REAL,
          hold_sortino    REAL,
          passive_sortino REAL,
          sample_days     INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 16,
    name: 'coingecko_research',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS market_history_daily (
          source          TEXT    NOT NULL,
          asset_id        TEXT    NOT NULL,
          day_s           INTEGER NOT NULL,
          open            REAL,
          high            REAL,
          low             REAL,
          close           REAL    NOT NULL,
          market_cap_usd  REAL,
          volume_24h_usd  REAL,
          fetched_at      INTEGER NOT NULL,
          PRIMARY KEY (source, asset_id, day_s)
        );

        CREATE INDEX IF NOT EXISTS idx_market_history_asset_day
          ON market_history_daily (asset_id, day_s);

        CREATE TABLE IF NOT EXISTS global_market_history_daily (
          source          TEXT    NOT NULL,
          day_s           INTEGER NOT NULL,
          market_cap_usd  REAL    NOT NULL,
          volume_24h_usd  REAL,
          fetched_at      INTEGER NOT NULL,
          PRIMARY KEY (source, day_s)
        );

        CREATE TABLE IF NOT EXISTS coingecko_connection (
          singleton_id          INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          connected             INTEGER NOT NULL,
          plan                  TEXT    NOT NULL,
          rate_limit_per_minute INTEGER,
          monthly_credits       INTEGER,
          remaining_credits     INTEGER,
          current_monthly_calls INTEGER,
          maximum_history_years INTEGER,
          checked_at            INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS research_runs (
          id          TEXT    PRIMARY KEY,
          status      TEXT    NOT NULL,
          created_at  INTEGER NOT NULL,
          completed_at INTEGER,
          manifest_json TEXT  NOT NULL,
          result_json   TEXT,
          error         TEXT
        );
      `);
    },
  },
  {
    version: 17,
    name: 'durable_research_jobs',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS research_jobs (
          id            TEXT    PRIMARY KEY,
          kind          TEXT    NOT NULL CHECK (kind IN ('matrix', 'stress')),
          status        TEXT    NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
          created_at    INTEGER NOT NULL,
          started_at    INTEGER,
          completed_at  INTEGER,
          request_json  TEXT    NOT NULL,
          snapshot_json TEXT,
          progress_json TEXT    NOT NULL,
          result_json   TEXT,
          error         TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_research_jobs_status_created
          ON research_jobs (status, created_at);

        CREATE TABLE IF NOT EXISTS research_job_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id      TEXT    NOT NULL,
          at          INTEGER NOT NULL,
          event       TEXT    NOT NULL,
          detail_json TEXT,
          FOREIGN KEY (job_id) REFERENCES research_jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_research_job_events_job_at
          ON research_job_events (job_id, at);
      `);
    },
  },
];
