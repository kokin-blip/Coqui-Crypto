import type { Migration } from './types.js';

export const migrations81: readonly Migration[] = [{ version: 81, name: 'breakout_shadow_v1', up(db) {
  db.exec(`CREATE TABLE breakout_hourly_bars_v1 (
    profile_id TEXT NOT NULL, asset_id TEXT NOT NULL, start_ms INTEGER NOT NULL,
    open TEXT NOT NULL, high TEXT NOT NULL, low TEXT NOT NULL, close TEXT NOT NULL,
    volume TEXT, source TEXT NOT NULL CHECK(source IN ('authenticated','public')),
    retrieved_at_ms INTEGER NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    PRIMARY KEY(profile_id,asset_id,start_ms)
  );
  CREATE INDEX breakout_hourly_time ON breakout_hourly_bars_v1(profile_id,asset_id,start_ms);
  CREATE TABLE breakout_research_records_v1 (
    profile_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('study','shadow','failure')),
    record_key TEXT NOT NULL, at_ms INTEGER NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)), PRIMARY KEY(profile_id,kind,record_key)
  );
  CREATE INDEX breakout_research_time ON breakout_research_records_v1(profile_id,kind,at_ms);
  CREATE TRIGGER breakout_hourly_no_update BEFORE UPDATE ON breakout_hourly_bars_v1
    BEGIN SELECT RAISE(ABORT,'breakout hourly evidence is immutable'); END;
  CREATE TRIGGER breakout_hourly_no_delete BEFORE DELETE ON breakout_hourly_bars_v1
    BEGIN SELECT RAISE(ABORT,'breakout hourly evidence is immutable'); END;
  CREATE TRIGGER breakout_records_no_update BEFORE UPDATE ON breakout_research_records_v1
    BEGIN SELECT RAISE(ABORT,'breakout research evidence is immutable'); END;
  CREATE TRIGGER breakout_records_no_delete BEFORE DELETE ON breakout_research_records_v1
    BEGIN SELECT RAISE(ABORT,'breakout research evidence is immutable'); END;`);
} }];
