import type { Migration } from './types.js';

/** Profile-scoped workstation layout preferences and durable presentation commands. */
export const migrations51: readonly Migration[] = [{
  version: 51,
  name: 'profile_workspace_preferences_v1',
  up: (db) => {
    db.exec(`
      ALTER TABLE account_preferences_v1 ADD COLUMN workspace_mode TEXT NOT NULL
        DEFAULT 'advanced' CHECK (workspace_mode IN ('advanced', 'simple'));
      ALTER TABLE account_preferences_v1 ADD COLUMN overview_chart TEXT NOT NULL
        DEFAULT 'equity' CHECK (overview_chart IN ('equity', 'allocation'));
      ALTER TABLE account_preferences_v1 ADD COLUMN portfolio_chart TEXT NOT NULL
        DEFAULT 'holdings' CHECK (portfolio_chart IN ('holdings', 'allocation'));
      ALTER TABLE account_preferences_v1 ADD COLUMN markets_chart TEXT NOT NULL
        DEFAULT 'candles' CHECK (markets_chart IN ('candles', 'line'));
      ALTER TABLE account_preferences_v1 ADD COLUMN performance_chart TEXT NOT NULL
        DEFAULT 'equity' CHECK (performance_chart IN ('equity', 'drawdown', 'calendar', 'distribution'));
      ALTER TABLE account_preferences_v1 ADD COLUMN inspector_open INTEGER NOT NULL
        DEFAULT 1 CHECK (inspector_open IN (0, 1));
      ALTER TABLE account_preferences_v1 ADD COLUMN inspector_width_px INTEGER NOT NULL
        DEFAULT 320 CHECK (inspector_width_px BETWEEN 280 AND 420);
      ALTER TABLE account_preferences_v1 ADD COLUMN chart_ranges_json TEXT NOT NULL
        DEFAULT '{"overview":"1y","portfolio":"1y","markets":"1y","performance":"1y"}'
        CHECK (json_valid(chart_ranges_json) AND json_type(chart_ranges_json) = 'object');

      CREATE TABLE account_settings_commands_v1 (
        command_id      TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL,
        request_hash    TEXT NOT NULL CHECK (length(request_hash) = 64),
        outcome_json    TEXT NOT NULL CHECK (
          json_valid(outcome_json) AND json_type(outcome_json) = 'object'
        ),
        recorded_at_ms  INTEGER NOT NULL CHECK (recorded_at_ms >= 0)
      );
      CREATE INDEX account_settings_commands_v1_profile_time
        ON account_settings_commands_v1(profile_id, recorded_at_ms);
      CREATE TRIGGER account_settings_commands_v1_no_update
        BEFORE UPDATE ON account_settings_commands_v1
        BEGIN SELECT RAISE(ABORT, 'account settings commands are immutable'); END;
      CREATE TRIGGER account_settings_commands_v1_no_delete
        BEFORE DELETE ON account_settings_commands_v1
        BEGIN SELECT RAISE(ABORT, 'account settings commands are immutable'); END;
    `);
  },
}];
