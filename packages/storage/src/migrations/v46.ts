import type { Migration } from './types.js';

/**
 * The reconciliation resolution ledger.
 *
 * Migration 42 made balance discrepancies immutable evidence, which is right:
 * what the venue said is a fact and must not be edited. But it left no way to
 * record what a user *decided* about one, so every exception stayed open
 * forever and the portfolio screen could only ever list them read-only.
 *
 * A resolution is therefore a separate append-only row that points at the
 * evidence, exactly as `runtime_incidents` treats a resolution as a later
 * record rather than an edit. Superseding a decision means appending another;
 * the newest by `decided_at` is the current one, and the whole history stays
 * readable.
 *
 * **The `kind` enum is the invariant-12 boundary.** It admits only outcomes that
 * cannot invent or resize a tax lot:
 *
 * - `external_transfer_in` / `external_transfer_out` — the movement is explained
 *   by a transfer this application never saw. Nothing local changes.
 * - `matched_to_lot` — an existing lot explains it; `linked_lot_id` says which.
 *   The lot must already exist, so this records a match, never a creation.
 * - `provider_error` — the venue was wrong. Nothing local changes.
 * - `investigating` — explicitly parked, so an open exception is a decision
 *   rather than an oversight.
 *
 * Deliberately absent, and this is the point of the constraint: anything that
 * would mint a zero-basis lot or proportionally rescale existing lots. The
 * predecessor did both. A user who genuinely acquired an asset the app does not
 * know about records a real lot with a real basis first, and then matches it.
 */
export const migrations46: readonly Migration[] = [{
  version: 46,
  name: 'reconciliation_resolution_ledger',
  up: (db) => {
    db.exec(`
      CREATE TABLE reconciliation_resolutions_v1 (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL,
        discrepancy_id TEXT NOT NULL,
        kind           TEXT NOT NULL CHECK (kind IN (
          'external_transfer_in',
          'external_transfer_out',
          'matched_to_lot',
          'provider_error',
          'investigating'
        )),
        -- Required by 'matched_to_lot' and forbidden otherwise, so a match
        -- cannot be recorded without saying what it matched.
        linked_lot_id  TEXT,
        note           TEXT NOT NULL CHECK (length(note) <= 500),
        decided_at     INTEGER NOT NULL CHECK (decided_at >= 0),
        CHECK (
          (kind = 'matched_to_lot' AND linked_lot_id IS NOT NULL)
          OR (kind <> 'matched_to_lot' AND linked_lot_id IS NULL)
        ),
        FOREIGN KEY (discrepancy_id)
          REFERENCES coinbase_balance_discrepancies_v2(id),
        FOREIGN KEY (linked_lot_id) REFERENCES tax_lots_v2(id)
      );

      CREATE INDEX reconciliation_resolutions_v1_discrepancy
        ON reconciliation_resolutions_v1 (discrepancy_id, decided_at DESC, id);
      CREATE INDEX reconciliation_resolutions_v1_profile
        ON reconciliation_resolutions_v1 (profile_id, decided_at DESC, id);

      CREATE TRIGGER reconciliation_resolutions_v1_no_update
      BEFORE UPDATE ON reconciliation_resolutions_v1
      BEGIN SELECT RAISE(ABORT, 'reconciliation resolutions are append-only'); END;
      CREATE TRIGGER reconciliation_resolutions_v1_no_delete
      BEFORE DELETE ON reconciliation_resolutions_v1
      BEGIN SELECT RAISE(ABORT, 'reconciliation resolutions are append-only'); END;
    `);
  },
}];
