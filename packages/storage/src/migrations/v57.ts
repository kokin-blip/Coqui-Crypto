import type { Migration } from './types.js';

/** Preserve newer Coinbase fill details and immutable V2 transaction evidence. */
export const migrations57: readonly Migration[] = [{
  version: 57,
  name: 'coinbase_supplemental_evidence_v3',
  up: (db) => {
    db.exec(`
      ALTER TABLE coinbase_fill_evidence_v2 ADD COLUMN entry_id TEXT;
      ALTER TABLE coinbase_fill_evidence_v2 ADD COLUMN commission_detail_json TEXT;
      ALTER TABLE coinbase_sync_runs_v2
        ADD COLUMN transaction_page_count INTEGER NOT NULL DEFAULT 0
        CHECK (transaction_page_count >= 0);
      ALTER TABLE coinbase_sync_runs_v2
        ADD COLUMN transaction_row_count INTEGER NOT NULL DEFAULT 0
        CHECK (transaction_row_count >= 0);
      ALTER TABLE coinbase_sync_runs_v2
        ADD COLUMN fee_tier_captured INTEGER NOT NULL DEFAULT 0
        CHECK (fee_tier_captured IN (0, 1));
      CREATE UNIQUE INDEX coinbase_fill_evidence_v2_run_entry
        ON coinbase_fill_evidence_v2 (run_id, entry_id) WHERE entry_id IS NOT NULL;

      CREATE TABLE coinbase_transaction_evidence_v1 (
        run_id              TEXT NOT NULL,
        account_uuid        TEXT NOT NULL,
        transaction_id      TEXT NOT NULL,
        type                TEXT NOT NULL,
        status              TEXT NOT NULL,
        amount_text         TEXT NOT NULL,
        amount_currency     TEXT NOT NULL,
        native_amount_text  TEXT NOT NULL,
        native_currency     TEXT NOT NULL,
        created_at_ms       INTEGER NOT NULL CHECK (created_at_ms >= 0),
        updated_at_ms       INTEGER CHECK (updated_at_ms IS NULL OR updated_at_ms >= created_at_ms),
        resource_path       TEXT NOT NULL,
        PRIMARY KEY (run_id, account_uuid, transaction_id),
        FOREIGN KEY (run_id) REFERENCES coinbase_sync_runs_v2(id)
      );
      CREATE TRIGGER coinbase_transaction_evidence_v1_no_update
      BEFORE UPDATE ON coinbase_transaction_evidence_v1
      BEGIN SELECT RAISE(ABORT, 'coinbase transaction evidence is immutable'); END;
      CREATE TRIGGER coinbase_transaction_evidence_v1_no_delete
      BEFORE DELETE ON coinbase_transaction_evidence_v1
      BEGIN SELECT RAISE(ABORT, 'coinbase transaction evidence is immutable'); END;

      CREATE TABLE coinbase_fee_tier_evidence_v1 (
        run_id          TEXT PRIMARY KEY,
        pricing_tier    TEXT NOT NULL,
        maker_rate_text TEXT NOT NULL,
        taker_rate_text TEXT NOT NULL,
        usd_from_text   TEXT NOT NULL,
        usd_to_text     TEXT,
        FOREIGN KEY (run_id) REFERENCES coinbase_sync_runs_v2(id)
      );
      CREATE TRIGGER coinbase_fee_tier_evidence_v1_no_update
      BEFORE UPDATE ON coinbase_fee_tier_evidence_v1
      BEGIN SELECT RAISE(ABORT, 'coinbase fee tier evidence is immutable'); END;
      CREATE TRIGGER coinbase_fee_tier_evidence_v1_no_delete
      BEFORE DELETE ON coinbase_fee_tier_evidence_v1
      BEGIN SELECT RAISE(ABORT, 'coinbase fee tier evidence is immutable'); END;
    `);
  },
}];
