import type { Migration } from './types.js';

/** Derived news evidence is append-only and uses the existing SQLite lifecycle. */
export const migrations90: readonly Migration[] = [{ version: 90, name: 'news_intelligence_analysis_v1', up(db) {
  db.exec(`
    CREATE TABLE news_analysis_runs_v1 (
      id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64 AND id NOT GLOB '*[^a-f0-9]*'),
      input_cutoff_at INTEGER NOT NULL CHECK(typeof(input_cutoff_at)='integer' AND input_cutoff_at BETWEEN 0 AND 9007199254740991),
      completed_at INTEGER NOT NULL CHECK(typeof(completed_at)='integer' AND completed_at BETWEEN input_cutoff_at AND 9007199254740991),
      persisted_at INTEGER NOT NULL CHECK(typeof(persisted_at)='integer' AND persisted_at BETWEEN completed_at AND 9007199254740991),
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^a-f0-9]*'), evidence_json TEXT NOT NULL
    );
    CREATE TABLE news_observation_analyses_v1 (
      run_id TEXT NOT NULL REFERENCES news_analysis_runs_v1(id),
      observation_id TEXT NOT NULL REFERENCES news_observations_v1(id),
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^a-f0-9]*'), evidence_json TEXT NOT NULL,
      PRIMARY KEY(run_id,observation_id)
    );
    CREATE TABLE news_cluster_snapshots_v1 (
      run_id TEXT NOT NULL REFERENCES news_analysis_runs_v1(id), id TEXT NOT NULL,
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^a-f0-9]*'), evidence_json TEXT NOT NULL,
      PRIMARY KEY(run_id,id)
    );
    CREATE TABLE news_feature_snapshots_v1 (
      id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL REFERENCES news_analysis_runs_v1(id),
      instrument_key TEXT NOT NULL, cadence TEXT NOT NULL CHECK(cadence IN ('hourly','daily')),
      decision_at INTEGER NOT NULL CHECK(typeof(decision_at)='integer' AND decision_at BETWEEN 0 AND 9007199254740991),
      available_at INTEGER NOT NULL CHECK(typeof(available_at)='integer' AND available_at BETWEEN decision_at AND 9007199254740991),
      reconstruction INTEGER NOT NULL CHECK(reconstruction IN (0,1)),
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64 AND content_hash NOT GLOB '*[^a-f0-9]*'), evidence_json TEXT NOT NULL,
      UNIQUE(run_id,instrument_key,cadence,decision_at)
    );
    CREATE INDEX news_analysis_available_v1 ON news_analysis_runs_v1(persisted_at,id);
    CREATE INDEX news_feature_available_v1 ON news_feature_snapshots_v1(instrument_key,cadence,decision_at,available_at);
  `);
  for (const table of ['news_analysis_runs_v1', 'news_observation_analyses_v1', 'news_cluster_snapshots_v1', 'news_feature_snapshots_v1']) {
    db.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'news analysis evidence is immutable'); END;
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT, 'news analysis evidence is immutable'); END;`);
  }
} }];
