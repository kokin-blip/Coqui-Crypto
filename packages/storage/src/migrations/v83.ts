import type { Migration } from './types.js';

export const migrations83: readonly Migration[] = [{ version: 83, name: 'market_selector_shadow_v1', up(db) {
  db.exec(`CREATE TABLE market_selector_records_v1 (
    profile_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('study','shadow','failure')),
    record_key TEXT NOT NULL, at_ms INTEGER NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)), PRIMARY KEY(profile_id,kind,record_key)
  );
  CREATE INDEX market_selector_time ON market_selector_records_v1(profile_id,kind,at_ms);
  CREATE TRIGGER market_selector_no_update BEFORE UPDATE ON market_selector_records_v1
    BEGIN SELECT RAISE(ABORT,'market selector evidence is immutable'); END;
  CREATE TRIGGER market_selector_no_delete BEFORE DELETE ON market_selector_records_v1
    BEGIN SELECT RAISE(ABORT,'market selector evidence is immutable'); END;`);
} }];
