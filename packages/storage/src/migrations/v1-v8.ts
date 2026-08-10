import type { Migration } from './types.js';

/** Predecessor migrations 1-8, preserved at their original versions. */
export const migrations1To8: readonly Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tokens (
          mint            TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          symbol          TEXT NOT NULL,
          created_at      INTEGER NOT NULL,
          observed_at     INTEGER NOT NULL,
          price_sol       REAL,
          market_cap_sol  REAL,
          liquidity_sol   REAL,
          total_supply     TEXT NOT NULL,
          deployer_wallet  TEXT,
          mint_authority   TEXT,
          freeze_authority TEXT,
          token_program    TEXT,
          risky_extensions TEXT,
          source           TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS deployers (
          wallet          TEXT PRIMARY KEY,
          first_seen      INTEGER NOT NULL,
          tokens_launched INTEGER NOT NULL DEFAULT 0,
          known_rugs      INTEGER NOT NULL DEFAULT 0,
          linked_wallets  TEXT NOT NULL DEFAULT '[]',
          risk_score      REAL NOT NULL DEFAULT 0,
          notes           TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS trades (
          id           TEXT PRIMARY KEY,
          mode         TEXT NOT NULL,
          side         TEXT NOT NULL,
          mint         TEXT NOT NULL,
          amount_sol   REAL NOT NULL,
          token_amount TEXT NOT NULL,
          fee_sol      REAL NOT NULL,
          status       TEXT NOT NULL,
          tx_signature TEXT,
          signal_id    TEXT,
          created_at   INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tokens_deployer ON tokens (deployer_wallet);
        CREATE INDEX IF NOT EXISTS idx_trades_mint ON trades (mint);
        CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades (created_at);
      `);
    },
  },
  {
    version: 2,
    name: 'risk_reports_and_timestamp_indexes',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS risk_reports (
          mint        TEXT NOT NULL,
          score       REAL NOT NULL,
          tier        TEXT NOT NULL,
          sources     TEXT NOT NULL DEFAULT '[]',
          checks      TEXT NOT NULL DEFAULT '[]',
          computed_at INTEGER NOT NULL,
          PRIMARY KEY (mint, computed_at)
        );

        CREATE INDEX IF NOT EXISTS idx_risk_reports_mint ON risk_reports (mint);
        CREATE INDEX IF NOT EXISTS idx_tokens_observed_at ON tokens (observed_at);
        CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens (created_at);
        CREATE INDEX IF NOT EXISTS idx_deployers_risk_score ON deployers (risk_score);
      `);
    },
  },
  {
    version: 3,
    name: 'token_history',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS token_history (
          mint           TEXT NOT NULL,
          observed_at    INTEGER NOT NULL,
          price_sol      REAL,
          market_cap_sol REAL,
          liquidity_sol  REAL,
          risk_score     REAL,
          PRIMARY KEY (mint, observed_at)
        );

        CREATE INDEX IF NOT EXISTS idx_token_history_mint ON token_history (mint);
      `);
    },
  },
  {
    version: 4,
    name: 'signals',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS signals (
          id         TEXT PRIMARY KEY,
          mint       TEXT NOT NULL,
          type       TEXT NOT NULL,
          reason     TEXT NOT NULL,
          confidence REAL NOT NULL,
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_signals_mint ON signals (mint);
        CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals (created_at);
      `);
    },
  },
  {
    version: 5,
    name: 'sim_accounts',
    // Paper-trading state lives in its own tables so simulated P&L can never
    // contaminate live accounting (design notes §7). Trades stay in the shared
    // `trades` table — already tagged with `mode` — gaining an `account_id` link.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sim_accounts (
          id                   TEXT PRIMARY KEY,
          mode                 TEXT NOT NULL,
          starting_balance_sol REAL NOT NULL,
          cash_sol             REAL NOT NULL,
          realized_pnl_sol     REAL NOT NULL DEFAULT 0,
          unrealized_pnl_sol   REAL NOT NULL DEFAULT 0,
          updated_at           INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sim_positions (
          account_id    TEXT NOT NULL,
          mint          TEXT NOT NULL,
          token_amount  TEXT NOT NULL,
          avg_entry_sol REAL NOT NULL,
          decimals      INTEGER NOT NULL,
          PRIMARY KEY (account_id, mint)
        );

        CREATE TABLE IF NOT EXISTS sim_equity (
          account_id TEXT NOT NULL,
          t          INTEGER NOT NULL,
          equity_sol REAL NOT NULL,
          PRIMARY KEY (account_id, t)
        );

        ALTER TABLE trades ADD COLUMN account_id TEXT;

        CREATE INDEX IF NOT EXISTS idx_sim_positions_account ON sim_positions (account_id);
        CREATE INDEX IF NOT EXISTS idx_sim_equity_account ON sim_equity (account_id);
        CREATE INDEX IF NOT EXISTS idx_trades_account ON trades (account_id);
      `);
    },
  },
  {
    version: 6,
    name: 'tracked_wallets',
    // The "famous person" watchlist and the trades those wallets make. Mirrors
    // the TrackedWallet / WalletHit source-of-truth types (CLAUDE.md §5). Hits
    // denormalize the wallet label so a recorded hit renders correctly even
    // after the wallet is relabeled or removed.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tracked_wallets (
          address   TEXT PRIMARY KEY,
          label     TEXT NOT NULL,
          category  TEXT NOT NULL,
          twitter   TEXT,
          notes     TEXT,
          added_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS wallet_hits (
          id             TEXT PRIMARY KEY,
          address        TEXT NOT NULL,
          label          TEXT NOT NULL,
          mint           TEXT NOT NULL,
          token_name     TEXT,
          token_symbol   TEXT,
          side           TEXT NOT NULL,
          amount_sol     REAL NOT NULL,
          token_amount   REAL,
          market_cap_sol REAL,
          tx_signature   TEXT,
          at             INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_hits_at ON wallet_hits (at);
        CREATE INDEX IF NOT EXISTS idx_wallet_hits_address ON wallet_hits (address);
        CREATE INDEX IF NOT EXISTS idx_wallet_hits_mint ON wallet_hits (mint);
      `);
    },
  },
  {
    version: 7,
    name: 'app_settings',
    // Small key-value store for persisted UI/runtime toggles (e.g. whether the
    // auto-trader is armed). Plain strings; callers own (de)serialization.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 8,
    name: 'holdings',
    // Manual portfolio tracker — one row per coin (CoinGecko id), with the
    // quantity held and the average USD cost basis. No wallet sync; this is the
    // user's hand-entered book, priced live off the market providers.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS holdings (
          coin_id      TEXT PRIMARY KEY,
          symbol       TEXT NOT NULL,
          name         TEXT NOT NULL,
          amount       REAL NOT NULL,
          avg_cost_usd REAL NOT NULL,
          added_at     INTEGER NOT NULL
        );
      `);
    },
  },
];
