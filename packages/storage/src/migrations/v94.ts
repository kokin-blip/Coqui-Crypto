import type { Migration } from './types.js';

/** Explicit operator selections supplement, never rewrite, immutable associations. */
export const migrations94: readonly Migration[] = [{ version: 94, name: 'news_report_locations', up(db) {
  db.exec(`CREATE TABLE news_report_locations_v1 (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    report_hash TEXT NOT NULL, profile_id TEXT NOT NULL,
    selected_at INTEGER NOT NULL CHECK(selected_at>=0), report_path TEXT NOT NULL,
    FOREIGN KEY(report_hash,profile_id) REFERENCES news_report_associations_v1(report_hash,profile_id));
    CREATE INDEX news_report_location_scope ON news_report_locations_v1(profile_id,report_hash,sequence);
    CREATE TRIGGER news_report_locations_v1_no_update BEFORE UPDATE ON news_report_locations_v1
      BEGIN SELECT RAISE(ABORT,'report locations are immutable'); END;
    CREATE TRIGGER news_report_locations_v1_no_delete BEFORE DELETE ON news_report_locations_v1
      BEGIN SELECT RAISE(ABORT,'report locations are immutable'); END;`);
} }];
