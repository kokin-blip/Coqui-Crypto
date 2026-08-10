import type { Migration } from './types.js';

/** Predecessor migrations 24-28, preserved at their original versions. */
export const migrations24To28: readonly Migration[] = [
  {
    version: 24,
    name: 'research_job_integrity_metadata',
    up: (db) => {
      db.exec(`
        ALTER TABLE research_jobs ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE research_jobs ADD COLUMN snapshot_hash TEXT;
        ALTER TABLE research_jobs ADD COLUMN result_hash TEXT;
        ALTER TABLE research_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE research_jobs ADD COLUMN deadline_at INTEGER;
        ALTER TABLE research_jobs ADD COLUMN error_code TEXT;
      `);
    },
  },
  {
    version: 25,
    name: 'durable_safety_stops_and_coinbase_import_completion',
    up: (db) => {
      db.exec(`
        ALTER TABLE coinbase_import_jobs ADD COLUMN account_page_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE coinbase_import_jobs ADD COLUMN account_row_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE coinbase_import_jobs ADD COLUMN fill_page_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE coinbase_import_jobs ADD COLUMN fill_row_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE coinbase_import_jobs ADD COLUMN completion_state TEXT NOT NULL DEFAULT 'unknown';
        ALTER TABLE coinbase_import_jobs ADD COLUMN dataset_hash TEXT;
        ALTER TABLE coinbase_import_jobs ADD COLUMN failure_reason TEXT;

        CREATE TABLE IF NOT EXISTS wallet_safety_stop_state (
          profile_id             TEXT PRIMARY KEY,
          active                 INTEGER NOT NULL CHECK (active IN (0, 1)),
          kind                   TEXT NOT NULL,
          reason                 TEXT NOT NULL,
          triggered_at           INTEGER NOT NULL,
          acknowledged_at        INTEGER,
          acknowledgement_reason TEXT,
          updated_at             INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS wallet_safety_stop_events (
          id             TEXT PRIMARY KEY,
          profile_id     TEXT NOT NULL,
          action         TEXT NOT NULL CHECK (action IN ('activated', 'acknowledged')),
          kind           TEXT NOT NULL,
          reason         TEXT NOT NULL,
          at             INTEGER NOT NULL,
          run_id         TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_safety_stop_events_profile_at
          ON wallet_safety_stop_events (profile_id, at DESC);

        INSERT OR IGNORE INTO wallet_safety_stop_state
          (profile_id, active, kind, reason, triggered_at, acknowledged_at,
           acknowledgement_reason, updated_at)
        SELECT
          profile_id, 1, 'legacy_hard_stop',
          COALESCE(NULLIF(reason, ''), 'Preserved from the pre-v25 wallet risk state.'),
          updated_at, NULL, NULL, updated_at
        FROM wallet_risk_state
        WHERE hard_stopped = 1;

        INSERT OR IGNORE INTO wallet_safety_stop_events
          (id, profile_id, action, kind, reason, at, run_id)
        SELECT
          'migration-v25:' || profile_id, profile_id, 'activated', 'legacy_hard_stop',
          COALESCE(NULLIF(reason, ''), 'Preserved from the pre-v25 wallet risk state.'),
          updated_at, NULL
        FROM wallet_risk_state
        WHERE hard_stopped = 1;

        INSERT OR IGNORE INTO wallet_safety_stop_state
          (profile_id, active, kind, reason, triggered_at, acknowledged_at,
           acknowledgement_reason, updated_at)
        SELECT
          'legacy', 1, 'manual_kill',
          'Preserved from the pre-v25 kill switch.', CAST(strftime('%s','now') AS INTEGER) * 1000,
          NULL, NULL, CAST(strftime('%s','now') AS INTEGER) * 1000
        FROM app_settings
        WHERE key = 'kill_switch' AND value = '1';

        INSERT OR IGNORE INTO wallet_safety_stop_events
          (id, profile_id, action, kind, reason, at, run_id)
        SELECT
          'migration-v25:legacy-kill', 'legacy', 'activated', 'manual_kill',
          'Preserved from the pre-v25 kill switch.',
          CAST(strftime('%s','now') AS INTEGER) * 1000, NULL
        FROM app_settings
        WHERE key = 'kill_switch' AND value = '1';
      `);
    },
  },
  {
    version: 26,
    name: 'fill_driven_decimal_paper_execution_v3',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS paper_orders_v3 (
          id                     TEXT PRIMARY KEY,
          profile_id             TEXT NOT NULL,
          run_id                 TEXT NOT NULL,
          product_id             TEXT NOT NULL,
          canonical_asset_id     TEXT NOT NULL,
          side                   TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
          requested_quantity_text TEXT NOT NULL,
          requested_notional_text TEXT NOT NULL,
          state                  TEXT NOT NULL CHECK (
            state IN (
              'proposed', 'risk_approved', 'risk_rejected', 'submission_pending',
              'submitted', 'acknowledged', 'open', 'partially_filled', 'filled',
              'cancel_pending', 'cancelled', 'expired', 'unknown', 'reconciled'
            )
          ),
          product_rule_snapshot_id TEXT NOT NULL,
          decision_snapshot_hash TEXT NOT NULL,
          reason                 TEXT,
          created_at             INTEGER NOT NULL,
          updated_at             INTEGER NOT NULL,
          UNIQUE (profile_id, run_id, product_id, side)
        );

        CREATE TABLE IF NOT EXISTS paper_order_events_v3 (
          id          TEXT PRIMARY KEY,
          order_id    TEXT NOT NULL,
          profile_id  TEXT NOT NULL,
          sequence    INTEGER NOT NULL,
          state       TEXT NOT NULL,
          at          INTEGER NOT NULL,
          detail_json TEXT NOT NULL,
          UNIQUE (order_id, sequence),
          FOREIGN KEY (order_id) REFERENCES paper_orders_v3(id)
        );

        CREATE TABLE IF NOT EXISTS paper_fills_v3 (
          id                    TEXT PRIMARY KEY,
          order_id              TEXT NOT NULL,
          profile_id            TEXT NOT NULL,
          quantity_text         TEXT NOT NULL,
          execution_price_text  TEXT NOT NULL,
          notional_text         TEXT NOT NULL,
          venue_fee_text        TEXT NOT NULL,
          spread_cost_text      TEXT NOT NULL,
          slippage_cost_text    TEXT NOT NULL,
          impact_cost_text      TEXT NOT NULL,
          filled_at             INTEGER NOT NULL,
          market_snapshot_hash  TEXT NOT NULL,
          UNIQUE (order_id, id),
          FOREIGN KEY (order_id) REFERENCES paper_orders_v3(id)
        );

        CREATE TABLE IF NOT EXISTS paper_ledger_entries_v3 (
          id              TEXT PRIMARY KEY,
          profile_id      TEXT NOT NULL,
          run_id          TEXT NOT NULL,
          order_id        TEXT,
          fill_id         TEXT,
          account         TEXT NOT NULL CHECK (
            account IN ('cash', 'asset', 'venue_fee', 'opening', 'reconciliation')
          ),
          asset_id        TEXT,
          amount_usd_text TEXT NOT NULL,
          quantity_text   TEXT NOT NULL,
          at              INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS paper_balances_v3 (
          profile_id      TEXT NOT NULL,
          asset_id        TEXT NOT NULL,
          quantity_text   TEXT NOT NULL,
          updated_at      INTEGER NOT NULL,
          PRIMARY KEY (profile_id, asset_id)
        );

        CREATE TABLE IF NOT EXISTS paper_product_rule_snapshots_v3 (
          id                       TEXT PRIMARY KEY,
          product_id               TEXT NOT NULL,
          product_type             TEXT NOT NULL,
          status                   TEXT NOT NULL,
          trading_disabled         INTEGER NOT NULL CHECK (trading_disabled IN (0, 1)),
          cancel_only              INTEGER NOT NULL CHECK (cancel_only IN (0, 1)),
          limit_only               INTEGER NOT NULL CHECK (limit_only IN (0, 1)),
          post_only                INTEGER NOT NULL CHECK (post_only IN (0, 1)),
          view_only                INTEGER NOT NULL CHECK (view_only IN (0, 1)),
          base_increment_text      TEXT NOT NULL,
          quote_increment_text     TEXT NOT NULL,
          price_increment_text     TEXT NOT NULL,
          base_min_size_text       TEXT NOT NULL,
          base_max_size_text       TEXT,
          quote_min_size_text      TEXT NOT NULL,
          quote_max_size_text      TEXT,
          source                   TEXT NOT NULL,
          retrieved_at             INTEGER NOT NULL,
          response_hash            TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_paper_orders_v3_profile_created
          ON paper_orders_v3 (profile_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_paper_orders_v3_open
          ON paper_orders_v3 (profile_id, state, updated_at);
        CREATE INDEX IF NOT EXISTS idx_paper_order_events_v3_order_sequence
          ON paper_order_events_v3 (order_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_paper_fills_v3_profile_at
          ON paper_fills_v3 (profile_id, filled_at DESC);
        CREATE INDEX IF NOT EXISTS idx_paper_ledger_v3_profile_at
          ON paper_ledger_entries_v3 (profile_id, at);
      `);
    },
  },
  {
    version: 27,
    name: 'canonical_asset_identity_evidence',
    up: (db) => {
      db.exec(`
        ALTER TABLE canonical_assets ADD COLUMN coinbase_currency_id TEXT;
        ALTER TABLE canonical_assets ADD COLUMN coinbase_product_id TEXT;
        ALTER TABLE canonical_assets ADD COLUMN coingecko_id TEXT;
        ALTER TABLE canonical_assets ADD COLUMN platform TEXT;
        ALTER TABLE canonical_assets ADD COLUMN network TEXT;
        ALTER TABLE canonical_assets ADD COLUMN contract_address TEXT;
        ALTER TABLE canonical_assets ADD COLUMN decimals INTEGER;
        ALTER TABLE canonical_assets ADD COLUMN mapping_status TEXT NOT NULL DEFAULT 'unresolved';
        ALTER TABLE canonical_assets ADD COLUMN verification_evidence_json TEXT NOT NULL DEFAULT '{}';

        ALTER TABLE asset_provider_mappings ADD COLUMN platform TEXT;
        ALTER TABLE asset_provider_mappings ADD COLUMN network TEXT;
        ALTER TABLE asset_provider_mappings ADD COLUMN contract_address TEXT;
        ALTER TABLE asset_provider_mappings ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE asset_provider_mappings ADD COLUMN verified_at INTEGER;

        CREATE TABLE IF NOT EXISTS asset_mapping_events (
          id                 TEXT PRIMARY KEY,
          canonical_asset_id TEXT NOT NULL,
          provider           TEXT NOT NULL,
          provider_asset_id  TEXT NOT NULL,
          action             TEXT NOT NULL,
          status             TEXT NOT NULL,
          evidence_json      TEXT NOT NULL,
          at                 INTEGER NOT NULL,
          FOREIGN KEY (canonical_asset_id) REFERENCES canonical_assets(id)
        );

        CREATE INDEX IF NOT EXISTS idx_asset_mapping_events_asset_at
          ON asset_mapping_events (canonical_asset_id, at DESC);
      `);
    },
  },
  {
    version: 28,
    name: 'append_only_runtime_incidents',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS runtime_incidents (
          id          TEXT PRIMARY KEY,
          profile_id  TEXT NOT NULL,
          run_id      TEXT,
          kind        TEXT NOT NULL CHECK (
            kind IN (
              'stale_data', 'sequence_gap', 'reconciliation', 'scheduler_failure',
              'risk_stop', 'execution_fault', 'provider_invalid', 'worker_failure'
            )
          ),
          severity    TEXT NOT NULL CHECK (severity IN ('warning', 'blocking', 'critical')),
          source      TEXT NOT NULL,
          detail_json TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          resolved_at INTEGER,
          resolution  TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_runtime_incidents_profile_at
          ON runtime_incidents (profile_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_runtime_incidents_unresolved
          ON runtime_incidents (profile_id, resolved_at, severity);
      `);
    },
  },
];
