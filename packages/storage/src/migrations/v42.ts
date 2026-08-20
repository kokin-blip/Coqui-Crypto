import type { Migration } from './types.js';

/** Immutable Coinbase provider facts and unresolved balance discrepancies. */
export const migrations42: readonly Migration[] = [{
  version: 42,
  name: 'immutable_coinbase_account_evidence_v2',
  up: (db) => {
    db.exec(`
      CREATE TABLE coinbase_sync_runs_v2 (
        id                  TEXT PRIMARY KEY,
        origin_profile_id   TEXT NOT NULL,
        requested_at_ms     INTEGER NOT NULL CHECK (requested_at_ms >= 0),
        received_at_ms      INTEGER NOT NULL CHECK (received_at_ms >= requested_at_ms),
        account_page_count  INTEGER NOT NULL CHECK (account_page_count >= 1),
        fill_page_count     INTEGER NOT NULL CHECK (fill_page_count >= 1),
        account_row_count   INTEGER NOT NULL CHECK (account_row_count >= 0),
        fill_row_count      INTEGER NOT NULL CHECK (fill_row_count >= 0),
        dataset_hash        TEXT NOT NULL CHECK (length(dataset_hash) = 64),
        UNIQUE (origin_profile_id, requested_at_ms, received_at_ms, dataset_hash)
      );

      CREATE TABLE coinbase_account_evidence_v2 (
        run_id                  TEXT NOT NULL,
        account_uuid            TEXT NOT NULL,
        currency                TEXT NOT NULL,
        available_quantity_text TEXT NOT NULL,
        hold_quantity_text      TEXT NOT NULL,
        total_quantity_text     TEXT NOT NULL,
        active                  INTEGER NOT NULL CHECK (active IN (0, 1)),
        ready                   INTEGER NOT NULL CHECK (ready IN (0, 1)),
        default_account         INTEGER NOT NULL CHECK (default_account IN (0, 1)),
        provider_updated_at_ms  INTEGER CHECK (provider_updated_at_ms >= 0),
        PRIMARY KEY (run_id, account_uuid),
        FOREIGN KEY (run_id) REFERENCES coinbase_sync_runs_v2(id)
      );

      CREATE TABLE coinbase_fill_evidence_v2 (
        run_id               TEXT NOT NULL,
        trade_id             TEXT NOT NULL,
        order_id             TEXT NOT NULL,
        product_id           TEXT NOT NULL,
        side                 TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
        price_text           TEXT NOT NULL,
        size_text            TEXT NOT NULL,
        commission_text      TEXT NOT NULL,
        size_in_quote        INTEGER NOT NULL CHECK (size_in_quote IN (0, 1)),
        trade_at_ms          INTEGER NOT NULL CHECK (trade_at_ms >= 0),
        sequence_at_ms       INTEGER NOT NULL CHECK (sequence_at_ms >= 0),
        PRIMARY KEY (run_id, trade_id),
        FOREIGN KEY (run_id) REFERENCES coinbase_sync_runs_v2(id)
      );

      CREATE TABLE coinbase_balance_discrepancies_v2 (
        id                     TEXT PRIMARY KEY,
        run_id                 TEXT NOT NULL,
        currency               TEXT NOT NULL,
        kind                   TEXT NOT NULL CHECK (
          kind IN ('provider_exceeds_local', 'local_exceeds_provider')
        ),
        provider_quantity_text TEXT NOT NULL,
        local_quantity_text    TEXT NOT NULL,
        delta_quantity_text    TEXT NOT NULL,
        UNIQUE (run_id, currency),
        FOREIGN KEY (run_id) REFERENCES coinbase_sync_runs_v2(id)
      );

      CREATE INDEX coinbase_sync_runs_v2_origin_received
        ON coinbase_sync_runs_v2 (origin_profile_id, received_at_ms DESC, id DESC);
      CREATE INDEX coinbase_balance_discrepancies_v2_run_currency
        ON coinbase_balance_discrepancies_v2 (run_id, currency);

      CREATE TRIGGER coinbase_sync_runs_v2_no_update BEFORE UPDATE ON coinbase_sync_runs_v2
      BEGIN SELECT RAISE(ABORT, 'coinbase sync evidence is immutable'); END;
      CREATE TRIGGER coinbase_sync_runs_v2_no_delete BEFORE DELETE ON coinbase_sync_runs_v2
      BEGIN SELECT RAISE(ABORT, 'coinbase sync evidence is immutable'); END;
      CREATE TRIGGER coinbase_account_evidence_v2_no_update BEFORE UPDATE ON coinbase_account_evidence_v2
      BEGIN SELECT RAISE(ABORT, 'coinbase account evidence is immutable'); END;
      CREATE TRIGGER coinbase_account_evidence_v2_no_delete BEFORE DELETE ON coinbase_account_evidence_v2
      BEGIN SELECT RAISE(ABORT, 'coinbase account evidence is immutable'); END;
      CREATE TRIGGER coinbase_fill_evidence_v2_no_update BEFORE UPDATE ON coinbase_fill_evidence_v2
      BEGIN SELECT RAISE(ABORT, 'coinbase fill evidence is immutable'); END;
      CREATE TRIGGER coinbase_fill_evidence_v2_no_delete BEFORE DELETE ON coinbase_fill_evidence_v2
      BEGIN SELECT RAISE(ABORT, 'coinbase fill evidence is immutable'); END;
      CREATE TRIGGER coinbase_balance_discrepancies_v2_no_update
      BEFORE UPDATE ON coinbase_balance_discrepancies_v2
      BEGIN SELECT RAISE(ABORT, 'coinbase discrepancy evidence is immutable'); END;
      CREATE TRIGGER coinbase_balance_discrepancies_v2_no_delete
      BEFORE DELETE ON coinbase_balance_discrepancies_v2
      BEGIN SELECT RAISE(ABORT, 'coinbase discrepancy evidence is immutable'); END;
    `);
  },
}];
