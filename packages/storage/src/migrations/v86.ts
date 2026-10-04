import type { Migration } from './types.js';
export const migrations86: readonly Migration[] = [{ version: 86, name: 'research_integrity_governance_v2', up(db) {
  db.exec(`CREATE TABLE research_integrity_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL, kind TEXT NOT NULL, record_key TEXT NOT NULL,
    at_ms INTEGER NOT NULL CHECK(at_ms>=0), body_json TEXT NOT NULL CHECK(json_valid(body_json)),
    content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    UNIQUE(namespace,kind,record_key)
  );
  CREATE INDEX research_integrity_lookup ON research_integrity_events(namespace,kind,sequence);
  CREATE TRIGGER research_integrity_no_update BEFORE UPDATE ON research_integrity_events
    BEGIN SELECT RAISE(ABORT,'research integrity evidence is immutable'); END;
  CREATE TRIGGER research_integrity_no_delete BEFORE DELETE ON research_integrity_events
    BEGIN SELECT RAISE(ABORT,'research integrity evidence is immutable'); END;`);
} }];
