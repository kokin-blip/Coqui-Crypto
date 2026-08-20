import type { Migration } from './types.js';

/** Profile-scoped display selection, separate from immutable research universes. */
export const migrations43: readonly Migration[] = [{
  version: 43,
  name: 'profile_display_universe_v1',
  up: (db) => {
    db.exec(`
      CREATE TABLE display_universe_items_v1 (
        profile_id    TEXT NOT NULL,
        position      INTEGER NOT NULL CHECK (position >= 0 AND position < 100),
        venue         TEXT NOT NULL CHECK (venue = 'coinbase'),
        product_id    TEXT NOT NULL,
        product_type  TEXT NOT NULL CHECK (product_type = 'spot'),
        selected_at   INTEGER NOT NULL CHECK (selected_at >= 0),
        PRIMARY KEY (profile_id, venue, product_id, product_type),
        UNIQUE (profile_id, position),
        FOREIGN KEY (venue, product_id, product_type)
          REFERENCES canonical_instruments (venue, product_id, product_type)
      );

      CREATE INDEX display_universe_items_v1_profile_position
        ON display_universe_items_v1 (profile_id, position);

      CREATE TABLE display_universe_events_v1 (
        id                 TEXT PRIMARY KEY,
        origin_profile_id  TEXT NOT NULL,
        recorded_at_ms     INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
        selection_json     TEXT NOT NULL CHECK (
          json_valid(selection_json) AND json_type(selection_json) = 'array'
        ),
        selection_hash     TEXT NOT NULL CHECK (length(selection_hash) = 64)
      );

      CREATE INDEX display_universe_events_v1_origin_recorded
        ON display_universe_events_v1 (origin_profile_id, recorded_at_ms, id);

      CREATE TRIGGER display_universe_events_v1_no_update
      BEFORE UPDATE ON display_universe_events_v1
      BEGIN SELECT RAISE(ABORT, 'display universe event is immutable'); END;
      CREATE TRIGGER display_universe_events_v1_no_delete
      BEFORE DELETE ON display_universe_events_v1
      BEGIN SELECT RAISE(ABORT, 'display universe event is immutable'); END;
    `);
  },
}];
