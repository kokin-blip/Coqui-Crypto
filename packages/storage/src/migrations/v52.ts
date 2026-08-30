import type { Migration } from './types.js';

/** Saved Advanced Overview composition and display-only chart preferences. */
export const migrations52: readonly Migration[] = [{
  version: 52,
  name: 'advanced_overview_research_grid_v1',
  up: (db) => {
    db.exec(`
      ALTER TABLE account_preferences_v1 ADD COLUMN advanced_overview_preset TEXT NOT NULL
        DEFAULT 'research_grid' CHECK (advanced_overview_preset IN (
          'research_grid', 'chart_focus', 'evidence_review', 'custom'
        ));
      ALTER TABLE account_preferences_v1 ADD COLUMN advanced_overview_panels_json TEXT NOT NULL
        DEFAULT '{"strategyDetail":true,"strategyComparison":true,"recentActivity":true,"proposalPreview":true,"healthStrip":true,"negativeFindings":true}'
        CHECK (json_valid(advanced_overview_panels_json) AND json_type(advanced_overview_panels_json) = 'object');
      ALTER TABLE account_preferences_v1 ADD COLUMN overview_series_style TEXT NOT NULL
        DEFAULT 'area' CHECK (overview_series_style IN ('line', 'area', 'baseline'));
      ALTER TABLE account_preferences_v1 ADD COLUMN overview_benchmark_visible INTEGER NOT NULL
        DEFAULT 1 CHECK (overview_benchmark_visible IN (0, 1));
      ALTER TABLE account_preferences_v1 ADD COLUMN market_volume_visible INTEGER NOT NULL
        DEFAULT 1 CHECK (market_volume_visible IN (0, 1));
      ALTER TABLE account_preferences_v1 ADD COLUMN market_indicators_json TEXT NOT NULL
        DEFAULT '{"sma20":false,"sma50":false,"ema20":false,"bollinger20":false,"rsi14":false,"macd":false}'
        CHECK (json_valid(market_indicators_json) AND json_type(market_indicators_json) = 'object');

      CREATE TABLE chart_snapshot_commands_v1 (
        command_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
        outcome TEXT NOT NULL CHECK (outcome IN ('saved', 'cancelled')),
        recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0)
      );
      CREATE INDEX chart_snapshot_commands_v1_profile_time
        ON chart_snapshot_commands_v1(profile_id, recorded_at_ms);
      CREATE TRIGGER chart_snapshot_commands_v1_no_update BEFORE UPDATE ON chart_snapshot_commands_v1
        BEGIN SELECT RAISE(ABORT, 'chart snapshot commands are immutable'); END;
      CREATE TRIGGER chart_snapshot_commands_v1_no_delete BEFORE DELETE ON chart_snapshot_commands_v1
        BEGIN SELECT RAISE(ABORT, 'chart snapshot commands are immutable'); END;
    `);
  },
}];
