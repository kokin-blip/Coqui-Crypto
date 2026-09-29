import type { Migration } from './types.js';

export const migrations84: readonly Migration[] = [{ version: 84, name: 'hourly_execution_shadow_v1', up(db) {
  db.exec(`CREATE TABLE hourly_execution_records_v1 (
    profile_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('study','observation','shadow','failure')),
    record_key TEXT NOT NULL, at_ms INTEGER NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)), PRIMARY KEY(profile_id,kind,record_key)
  );
  CREATE INDEX hourly_execution_time ON hourly_execution_records_v1(profile_id,kind,at_ms);
  CREATE TRIGGER hourly_execution_no_update BEFORE UPDATE ON hourly_execution_records_v1
    BEGIN SELECT RAISE(ABORT,'hourly execution evidence is immutable'); END;
  CREATE TRIGGER hourly_execution_no_delete BEFORE DELETE ON hourly_execution_records_v1
    BEGIN SELECT RAISE(ABORT,'hourly execution evidence is immutable'); END;`);
} }];
