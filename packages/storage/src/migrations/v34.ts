import type { Migration } from './types.js';

/** Bounded local operational observations for diagnostics across restarts. */
export const migrations34: readonly Migration[] = [{
  version: 34,
  name: 'operational_metric_observations',
  up: (db) => {
    db.exec(`
      CREATE TABLE operational_metric_observations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        recorded_at_ms  INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
        name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
        kind            TEXT NOT NULL CHECK (kind IN ('counter', 'gauge', 'histogram')),
        value           INTEGER NOT NULL CHECK (value >= 0),
        labels_json     TEXT NOT NULL CHECK (length(labels_json) <= 1024)
      );

      CREATE INDEX idx_operational_metrics_name_time
        ON operational_metric_observations (name, recorded_at_ms DESC, id DESC);
      CREATE INDEX idx_operational_metrics_retention
        ON operational_metric_observations (recorded_at_ms, id);
    `);
  },
}];
