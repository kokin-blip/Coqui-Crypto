import type { Migration } from './types.js';

export const migrations95: readonly Migration[] = [{ version: 95, name: 'operations_activity_events_v1', up(db) {
  db.exec(`CREATE TABLE operations_activity_events_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), profile_id TEXT NOT NULL,
    work_id TEXT NOT NULL, attempt_id TEXT NOT NULL, worker TEXT NOT NULL,
    source TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL,
    at_ms INTEGER NOT NULL CHECK(at_ms>=0), deadline_at_ms INTEGER,
    facts_json TEXT NOT NULL CHECK(json_valid(facts_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE INDEX operations_activity_profile_time ON operations_activity_events_v1(profile_id,at_ms DESC,id DESC);
    CREATE INDEX operations_activity_worker ON operations_activity_events_v1(profile_id,worker,at_ms DESC,id DESC);
    CREATE INDEX operations_activity_source_ref ON operations_activity_events_v1(profile_id,json_extract(facts_json,'$.sourceRecord'));
    CREATE INDEX operations_activity_work ON operations_activity_events_v1(profile_id,work_id,at_ms,id);
    CREATE TRIGGER operations_activity_no_update BEFORE UPDATE ON operations_activity_events_v1
      BEGIN SELECT RAISE(ABORT,'operations activity is immutable'); END;
    CREATE TRIGGER operations_activity_no_delete BEFORE DELETE ON operations_activity_events_v1
      BEGIN SELECT RAISE(ABORT,'operations activity is immutable'); END;`);
} }];
