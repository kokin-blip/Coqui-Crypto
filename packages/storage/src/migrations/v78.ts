import type { Migration } from './types.js';

export const migrations78: readonly Migration[] = [{
  version: 78,
  name: 'parallel_paper_experiment_v1',
  up(db) {
    db.exec(`
      CREATE TABLE parallel_paper_experiments_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        profile_id TEXT NOT NULL,
        source_connection_snapshot_id TEXT NOT NULL REFERENCES connection_account_snapshots_v2(id),
        alpaca_account_id TEXT NOT NULL,
        opening_coqui_cash TEXT NOT NULL,
        opening_alpaca_cash TEXT NOT NULL,
        opening_alpaca_equity TEXT NOT NULL,
        anchor_json TEXT NOT NULL CHECK(json_valid(anchor_json)),
        started_at INTEGER NOT NULL CHECK(started_at>=0),
        config_version TEXT NOT NULL
      );
      CREATE INDEX parallel_paper_experiment_profile ON parallel_paper_experiments_v1(profile_id,started_at DESC);
      CREATE TABLE parallel_paper_events_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        experiment_id TEXT NOT NULL REFERENCES parallel_paper_experiments_v1(id),
        profile_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        at INTEGER NOT NULL CHECK(at>=0),
        detail_json TEXT NOT NULL CHECK(json_valid(detail_json))
      );
      CREATE INDEX parallel_paper_event_order ON parallel_paper_events_v1(experiment_id,at,id);
      CREATE TRIGGER parallel_paper_experiments_no_update BEFORE UPDATE ON parallel_paper_experiments_v1
        BEGIN SELECT RAISE(ABORT,'parallel experiment is immutable'); END;
      CREATE TRIGGER parallel_paper_experiments_no_delete BEFORE DELETE ON parallel_paper_experiments_v1
        BEGIN SELECT RAISE(ABORT,'parallel experiment is immutable'); END;
      CREATE TRIGGER parallel_paper_events_no_update BEFORE UPDATE ON parallel_paper_events_v1
        BEGIN SELECT RAISE(ABORT,'parallel paper ledger is append-only'); END;
      CREATE TRIGGER parallel_paper_events_no_delete BEFORE DELETE ON parallel_paper_events_v1
        BEGIN SELECT RAISE(ABORT,'parallel paper ledger is append-only'); END;
      CREATE TRIGGER parallel_paper_events_profile_guard BEFORE INSERT ON parallel_paper_events_v1
      WHEN NOT EXISTS (SELECT 1 FROM parallel_paper_experiments_v1 x
        WHERE x.id=NEW.experiment_id AND x.profile_id=NEW.profile_id)
        BEGIN SELECT RAISE(ABORT,'parallel event profile mismatch'); END;
    `);
  },
}];
