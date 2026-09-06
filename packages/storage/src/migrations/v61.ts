import type { Migration } from './types.js';

export const migrations61: readonly Migration[] = [{
  version: 61,
  name: 'paper_campaign_plans_v2',
  up(db) {
    db.exec(`
      CREATE TABLE paper_campaign_plans_v2 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64),
        profile_id TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        strategy_version TEXT NOT NULL,
        config_hash TEXT NOT NULL CHECK (length(config_hash) = 64),
        code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
        evidence_schema_version INTEGER NOT NULL CHECK (evidence_schema_version = 1),
        cost_model_hash TEXT NOT NULL CHECK (length(cost_model_hash) = 64),
        prospective_start INTEGER NOT NULL CHECK (prospective_start >= 0),
        content_json TEXT NOT NULL CHECK (json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        UNIQUE(profile_id, strategy_version, config_hash)
      );
      CREATE INDEX paper_campaign_plans_v2_profile_start
        ON paper_campaign_plans_v2(profile_id, prospective_start DESC);
      CREATE TRIGGER paper_campaign_plans_v2_no_update BEFORE UPDATE ON paper_campaign_plans_v2
      BEGIN SELECT RAISE(ABORT, 'paper campaign plans are immutable'); END;
      CREATE TRIGGER paper_campaign_plans_v2_no_delete BEFORE DELETE ON paper_campaign_plans_v2
      BEGIN SELECT RAISE(ABORT, 'paper campaign plans are immutable'); END;
    `);
  },
}];
