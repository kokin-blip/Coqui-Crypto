import type { Migration } from './types.js';

/** Typed alert policy, canonical targets, immutable facts, and presentation state. */
export const migrations40: readonly Migration[] = [{
  version: 40,
  name: 'typed_append_only_alerts',
  up: (db) => {
    db.exec(`
      CREATE TABLE alert_rule_configs_v2 (
        profile_id                TEXT PRIMARY KEY,
        drift_enabled             INTEGER NOT NULL CHECK (drift_enabled IN (0, 1)),
        regime_enabled            INTEGER NOT NULL CHECK (regime_enabled IN (0, 1)),
        big_move_enabled          INTEGER NOT NULL CHECK (big_move_enabled IN (0, 1)),
        big_move_pct_text         TEXT NOT NULL,
        price_target_enabled      INTEGER NOT NULL CHECK (price_target_enabled IN (0, 1)),
        sound_enabled             INTEGER NOT NULL CHECK (sound_enabled IN (0, 1)),
        quiet_hours_enabled       INTEGER NOT NULL CHECK (quiet_hours_enabled IN (0, 1)),
        quiet_start_hour          INTEGER NOT NULL CHECK (quiet_start_hour BETWEEN 0 AND 23),
        quiet_end_hour            INTEGER NOT NULL CHECK (quiet_end_hour BETWEEN 0 AND 23),
        updated_at                INTEGER NOT NULL CHECK (updated_at >= 0)
      );

      CREATE TABLE alert_price_targets_v2 (
        id                 TEXT PRIMARY KEY,
        profile_id         TEXT NOT NULL,
        venue              TEXT NOT NULL CHECK (venue = 'coinbase'),
        product_id         TEXT NOT NULL,
        product_type       TEXT NOT NULL CHECK (product_type = 'spot'),
        direction          TEXT NOT NULL CHECK (direction IN ('above', 'below')),
        price_usd_text     TEXT NOT NULL,
        enabled            INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at         INTEGER NOT NULL CHECK (created_at >= 0),
        triggered_at       INTEGER CHECK (triggered_at IS NULL OR triggered_at >= created_at),
        removed_at         INTEGER CHECK (removed_at IS NULL OR removed_at >= created_at)
      );

      CREATE INDEX alert_price_targets_profile_active
        ON alert_price_targets_v2 (profile_id, removed_at, created_at DESC, id);

      CREATE TRIGGER alert_price_targets_no_delete
      BEFORE DELETE ON alert_price_targets_v2
      BEGIN SELECT RAISE(ABORT, 'alert price targets use removal tombstones'); END;

      CREATE TABLE alert_events_v2 (
        id                 TEXT PRIMARY KEY,
        profile_id         TEXT NOT NULL,
        event_key          TEXT NOT NULL,
        kind               TEXT NOT NULL CHECK (kind IN
          ('allocation_drift', 'regime_change', 'big_move', 'price_target',
           'policy_event', 'evidence_change')),
        severity           TEXT NOT NULL CHECK (severity IN ('info', 'warn')),
        reason_code        TEXT NOT NULL,
        evidence_hash      TEXT NOT NULL CHECK (length(evidence_hash) = 64),
        venue              TEXT,
        product_id         TEXT,
        product_type       TEXT,
        occurred_at        INTEGER NOT NULL CHECK (occurred_at >= 0),
        recorded_at        INTEGER NOT NULL CHECK (recorded_at >= occurred_at),
        UNIQUE (profile_id, event_key),
        CHECK (
          (venue IS NULL AND product_id IS NULL AND product_type IS NULL) OR
          (venue = 'coinbase' AND product_id IS NOT NULL AND product_type = 'spot')
        )
      );

      CREATE INDEX alert_events_profile_time
        ON alert_events_v2 (profile_id, occurred_at DESC, id DESC);

      CREATE TRIGGER alert_events_no_update
      BEFORE UPDATE ON alert_events_v2
      BEGIN SELECT RAISE(ABORT, 'alert facts are append-only'); END;

      CREATE TRIGGER alert_events_no_delete
      BEFORE DELETE ON alert_events_v2
      BEGIN SELECT RAISE(ABORT, 'alert facts are append-only'); END;

      CREATE TABLE alert_event_visibility_v2 (
        event_id       TEXT PRIMARY KEY REFERENCES alert_events_v2(id),
        profile_id     TEXT NOT NULL,
        read_at        INTEGER CHECK (read_at IS NULL OR read_at >= 0),
        archived_at    INTEGER CHECK (archived_at IS NULL OR archived_at >= 0)
      );

      CREATE INDEX alert_visibility_profile
        ON alert_event_visibility_v2 (profile_id, archived_at, read_at);
    `);
  },
}];
