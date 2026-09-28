import type { Migration } from './types.js';

export const migrations80: readonly Migration[] = [{ version: 80, name: 'wider_universe_shadow_v1', up(db) {
  db.exec(`CREATE TABLE wider_universe_records_v1 (
    profile_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('policy','study','catalog','observation','frame','shadow','failure')),
    record_key TEXT NOT NULL, at_ms INTEGER NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)), PRIMARY KEY(profile_id,kind,record_key)
  );
  CREATE INDEX wider_universe_time ON wider_universe_records_v1(profile_id,kind,at_ms);
  CREATE TRIGGER wider_universe_no_update BEFORE UPDATE ON wider_universe_records_v1
    BEGIN SELECT RAISE(ABORT,'universe evidence is immutable'); END;
  CREATE TRIGGER wider_universe_no_delete BEFORE DELETE ON wider_universe_records_v1
    BEGIN SELECT RAISE(ABORT,'universe evidence is immutable'); END;`);
} }];
