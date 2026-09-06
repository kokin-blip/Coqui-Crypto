import type { Migration } from './types.js';

export const migrations59: readonly Migration[] = [{
  version: 59,
  name: 'paper_book_origins_v1',
  up(db) {
    db.exec(`
      CREATE TABLE paper_book_origins_v1 (
        profile_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
        snapshot_hash TEXT NOT NULL UNIQUE CHECK (length(snapshot_hash) = 64),
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      );
      CREATE TRIGGER paper_book_origins_v1_no_update BEFORE UPDATE ON paper_book_origins_v1
      BEGIN SELECT RAISE(ABORT, 'paper book origins are immutable'); END;
      CREATE TRIGGER paper_book_origins_v1_no_delete BEFORE DELETE ON paper_book_origins_v1
      BEGIN SELECT RAISE(ABORT, 'paper book origins are immutable'); END;
    `);
  },
}];
