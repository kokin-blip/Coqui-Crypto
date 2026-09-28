import type { Migration } from './types.js';

export const migrations82: readonly Migration[] = [{ version: 82, name: 'range_rotation_shadow_v1', up(db) {
  db.exec(`CREATE TABLE range_rotation_records_v1 (
    profile_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('study','shadow','failure')),
    record_key TEXT NOT NULL, at_ms INTEGER NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)), PRIMARY KEY(profile_id,kind,record_key)
  );
  CREATE INDEX range_rotation_time ON range_rotation_records_v1(profile_id,kind,at_ms);
  CREATE TRIGGER range_rotation_no_update BEFORE UPDATE ON range_rotation_records_v1
    BEGIN SELECT RAISE(ABORT,'range rotation evidence is immutable'); END;
  CREATE TRIGGER range_rotation_no_delete BEFORE DELETE ON range_rotation_records_v1
    BEGIN SELECT RAISE(ABORT,'range rotation evidence is immutable'); END;`);
} }];
