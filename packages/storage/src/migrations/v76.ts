import type { Migration } from './types.js';

export const migrations76: readonly Migration[] = [{
  version: 76,
  name: 'robinhood_guided_setups_v1',
  up(db) {
    db.exec(`
      CREATE TABLE robinhood_connection_setups_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=36),
        profile_id TEXT NOT NULL,
        public_key_base64 TEXT NOT NULL CHECK(length(public_key_base64) BETWEEN 40 AND 48),
        status TEXT NOT NULL CHECK(status IN ('pending','completed','cancelled','expired')),
        created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
        expires_at_ms INTEGER NOT NULL CHECK(expires_at_ms>created_at_ms),
        completed_at_ms INTEGER CHECK(completed_at_ms IS NULL OR completed_at_ms>=created_at_ms)
      );
      CREATE INDEX robinhood_connection_setups_v1_profile_time
        ON robinhood_connection_setups_v1(profile_id,created_at_ms DESC);
    `);
  },
}];
