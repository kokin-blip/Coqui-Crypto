import type { Migration } from './types.js';

/** Durable presentation-only watchlists, layouts, drawings, and preferences. */
export const migrations54: readonly Migration[] = [{
  version: 54,
  name: 'chart_workspace_preferences_v1',
  up: (db) => {
    db.exec(`
      ALTER TABLE account_preferences_v1 ADD COLUMN market_interval TEXT NOT NULL
        DEFAULT '1d' CHECK (market_interval IN ('1m', '5m', '15m', '1h', '6h', '1d'));
      ALTER TABLE account_preferences_v1 ADD COLUMN market_scale_mode TEXT NOT NULL
        DEFAULT 'linear' CHECK (market_scale_mode IN ('linear', 'percentage', 'indexed', 'logarithmic'));
      ALTER TABLE account_preferences_v1 ADD COLUMN market_live_candle INTEGER NOT NULL
        DEFAULT 0 CHECK (market_live_candle IN (0, 1));
      ALTER TABLE account_preferences_v1 ADD COLUMN market_layout TEXT NOT NULL
        DEFAULT 'single' CHECK (market_layout IN ('single', 'horizontal', 'vertical', 'grid', 'dominant'));

      CREATE TABLE chart_watchlists_v1 (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
        products_json TEXT NOT NULL CHECK (json_valid(products_json) AND json_type(products_json) = 'array'),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
      );
      CREATE UNIQUE INDEX chart_watchlists_v1_profile_name
        ON chart_watchlists_v1(profile_id, name COLLATE NOCASE);

      CREATE TABLE chart_layouts_v1 (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
        layout TEXT NOT NULL CHECK (layout IN ('single', 'horizontal', 'vertical', 'grid', 'dominant')),
        tiles_json TEXT NOT NULL CHECK (json_valid(tiles_json) AND json_type(tiles_json) = 'array'),
        updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
      );
      CREATE UNIQUE INDEX chart_layouts_v1_profile_name
        ON chart_layouts_v1(profile_id, name COLLATE NOCASE);

      CREATE TABLE chart_drawings_v1 (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        layout_id TEXT,
        product_id TEXT NOT NULL,
        interval TEXT NOT NULL CHECK (interval IN ('1m', '5m', '15m', '1h', '6h', '1d')),
        kind TEXT NOT NULL CHECK (kind IN ('horizontal', 'vertical', 'trend', 'ray', 'rectangle', 'fibonacci', 'text', 'measure')),
        points_json TEXT NOT NULL CHECK (json_valid(points_json) AND json_type(points_json) = 'array'),
        options_json TEXT NOT NULL CHECK (json_valid(options_json) AND json_type(options_json) = 'object'),
        updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
      );
      CREATE INDEX chart_drawings_v1_context
        ON chart_drawings_v1(profile_id, product_id, interval, layout_id);

      CREATE TABLE chart_workspace_commands_v1 (
        command_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
        outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json)),
        recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0)
      );
      CREATE TRIGGER chart_workspace_commands_v1_no_update BEFORE UPDATE ON chart_workspace_commands_v1
        BEGIN SELECT RAISE(ABORT, 'chart workspace commands are immutable'); END;
      CREATE TRIGGER chart_workspace_commands_v1_no_delete BEFORE DELETE ON chart_workspace_commands_v1
        BEGIN SELECT RAISE(ABORT, 'chart workspace commands are immutable'); END;
    `);
  },
}];
