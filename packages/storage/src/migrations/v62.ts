import type { Migration } from './types.js';

export const migrations62: readonly Migration[] = [{
  version: 62,
  name: 'profile_connections_v1',
  up(db) {
    db.exec(`
      CREATE TABLE profile_connections_v1 (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider = 'coinbase'),
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
        external_identity_hash TEXT NOT NULL CHECK (length(external_identity_hash) = 64),
        capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
        status TEXT NOT NULL CHECK (status IN ('active','attention_required','disconnected')),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
        UNIQUE(profile_id, provider, external_identity_hash)
      );
      CREATE INDEX profile_connections_v1_profile_provider
        ON profile_connections_v1(profile_id, provider, status);
      CREATE TRIGGER profile_connections_v1_identity_immutable
      BEFORE UPDATE OF id, profile_id, provider, external_identity_hash, created_at
      ON profile_connections_v1
      BEGIN SELECT RAISE(ABORT, 'connection identity is immutable'); END;
    `);
  },
}];
