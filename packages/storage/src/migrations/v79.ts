import type { Migration } from './types.js';

export const migrations79: readonly Migration[] = [{
  version: 79,
  name: 'ml_signal_hourly_history_v1',
  up(db) {
    db.exec(`
      CREATE TABLE ml_signal_hourly_bars_v1 (
        profile_id TEXT NOT NULL,
        product_id TEXT NOT NULL CHECK(product_id IN ('BTC-USD','ETH-USD','LTC-USD')),
        start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
        open TEXT NOT NULL, high TEXT NOT NULL, low TEXT NOT NULL, close TEXT NOT NULL,
        volume TEXT, source TEXT NOT NULL CHECK(source IN ('authenticated','public')),
        retrieved_at_ms INTEGER NOT NULL,
        PRIMARY KEY (profile_id, product_id, start_ms)
      );
      CREATE INDEX ml_signal_hourly_time ON ml_signal_hourly_bars_v1(profile_id,start_ms);
      CREATE TABLE ml_signal_studies_v1 (
        profile_id TEXT NOT NULL,
        candidate_version TEXT NOT NULL,
        registered_at_ms INTEGER NOT NULL,
        study_end_ms INTEGER NOT NULL,
        dataset_hash TEXT NOT NULL CHECK(length(dataset_hash)=64),
        plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64),
        plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
        result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
        PRIMARY KEY(profile_id,candidate_version)
      );
      CREATE TRIGGER ml_signal_study_no_delete BEFORE DELETE ON ml_signal_studies_v1
        BEGIN SELECT RAISE(ABORT,'ML study cannot be deleted'); END;
      CREATE TRIGGER ml_signal_study_guard BEFORE UPDATE ON ml_signal_studies_v1
      WHEN OLD.result_json IS NOT NULL OR NEW.profile_id != OLD.profile_id OR
        NEW.candidate_version != OLD.candidate_version OR NEW.registered_at_ms != OLD.registered_at_ms OR
        NEW.study_end_ms != OLD.study_end_ms OR NEW.dataset_hash != OLD.dataset_hash OR
        NEW.plan_hash != OLD.plan_hash OR NEW.plan_json != OLD.plan_json OR NEW.result_json IS NULL
        BEGIN SELECT RAISE(ABORT,'ML study registration and result are immutable'); END;
    `);
  },
}];
