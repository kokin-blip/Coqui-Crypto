import type { Migration } from './types.js';

/** Append-only daily paper valuation evidence. Missing days remain missing. */
export const migrations48: readonly Migration[] = [{
  version: 48,
  name: 'daily_paper_valuation_evidence',
  up: (db) => {
    db.exec(`
      CREATE TABLE paper_daily_valuation_evidence_v1 (
        id                TEXT PRIMARY KEY,
        profile_id        TEXT NOT NULL,
        day_utc           INTEGER NOT NULL CHECK (day_utc >= 0 AND day_utc % 86400000 = 0),
        captured_at       INTEGER NOT NULL CHECK (captured_at >= day_utc),
        cash_usd_text     TEXT NOT NULL,
        equity_usd_text   TEXT,
        benchmark_usd_text TEXT,
        unpriced_count    INTEGER NOT NULL CHECK (unpriced_count >= 0),
        positions_json    TEXT NOT NULL CHECK (json_valid(positions_json) AND json_type(positions_json) = 'array'),
        provenance_json   TEXT NOT NULL CHECK (json_valid(provenance_json)),
        evidence_hash     TEXT NOT NULL CHECK (length(evidence_hash) = 64),
        UNIQUE (profile_id, day_utc),
        UNIQUE (profile_id, evidence_hash)
      );

      CREATE INDEX paper_daily_valuation_evidence_v1_profile_day
        ON paper_daily_valuation_evidence_v1 (profile_id, day_utc);

      CREATE TRIGGER paper_daily_valuation_evidence_v1_no_update
      BEFORE UPDATE ON paper_daily_valuation_evidence_v1
      BEGIN SELECT RAISE(ABORT, 'paper daily valuations are append-only'); END;
      CREATE TRIGGER paper_daily_valuation_evidence_v1_no_delete
      BEFORE DELETE ON paper_daily_valuation_evidence_v1
      BEGIN SELECT RAISE(ABORT, 'paper daily valuations are append-only'); END;
    `);
  },
}];
