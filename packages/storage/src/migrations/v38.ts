import type { Migration } from './types.js';

/** Append-only portfolio valuation facts with explicit completeness and timing. */
export const migrations38: readonly Migration[] = [{
  version: 38,
  name: 'append_only_portfolio_snapshot_evidence_v3',
  up: (db) => {
    db.exec(`
      CREATE TABLE portfolio_snapshot_evidence_v3 (
        id                         TEXT PRIMARY KEY,
        day_key_ms                 INTEGER NOT NULL CHECK (day_key_ms >= 0),
        scheduled_for_ms           INTEGER NOT NULL CHECK (scheduled_for_ms >= 0),
        observed_at_ms             INTEGER NOT NULL CHECK (observed_at_ms >= scheduled_for_ms),
        recorded_at_ms             INTEGER NOT NULL CHECK (recorded_at_ms >= observed_at_ms),
        valuation_status           TEXT NOT NULL CHECK (
          valuation_status IN ('complete', 'partial', 'unavailable', 'legacy_unverified')
        ),
        equity_usd_text            TEXT,
        priced_subtotal_usd_text   TEXT NOT NULL,
        open_cost_usd_text         TEXT NOT NULL,
        realized_pnl_usd_text      TEXT NOT NULL,
        unpriced_instruments_json  TEXT NOT NULL CHECK (
          json_valid(unpriced_instruments_json) AND
          json_type(unpriced_instruments_json) = 'array'
        ),
        UNIQUE (scheduled_for_ms, observed_at_ms),
        CHECK (
          (valuation_status = 'complete' AND equity_usd_text IS NOT NULL AND
            json_array_length(unpriced_instruments_json) = 0) OR
          (valuation_status <> 'complete' AND equity_usd_text IS NULL)
        ),
        CHECK (
          valuation_status <> 'partial' OR json_array_length(unpriced_instruments_json) > 0
        )
      );

      CREATE INDEX portfolio_snapshot_evidence_v3_day_observed
        ON portfolio_snapshot_evidence_v3 (day_key_ms, observed_at_ms, recorded_at_ms, id);

      INSERT INTO portfolio_snapshot_evidence_v3 (
        id, day_key_ms, scheduled_for_ms, observed_at_ms, recorded_at_ms,
        valuation_status, equity_usd_text, priced_subtotal_usd_text,
        open_cost_usd_text, realized_pnl_usd_text, unpriced_instruments_json
      )
      SELECT
        'portfolio:' || at || ':' || at, at, at, at, at,
        'legacy_unverified', NULL, value_usd_text,
        cost_usd_text, realized_pnl_usd_text, '[]'
      FROM portfolio_snapshots_v2;

      CREATE TRIGGER portfolio_snapshot_evidence_v3_no_update
      BEFORE UPDATE ON portfolio_snapshot_evidence_v3
      BEGIN SELECT RAISE(ABORT, 'portfolio snapshot evidence is immutable'); END;

      CREATE TRIGGER portfolio_snapshot_evidence_v3_no_delete
      BEFORE DELETE ON portfolio_snapshot_evidence_v3
      BEGIN SELECT RAISE(ABORT, 'portfolio snapshot evidence is immutable'); END;
    `);
  },
}];
