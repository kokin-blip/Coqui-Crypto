import type { Migration } from './types.js';

export const migrations71: readonly Migration[] = [{
  version: 71,
  name: 'profile_connections_v2_and_provider_accounts',
  up(db) {
    db.exec(`
      CREATE TABLE profile_connections_v2 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64), profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('coinbase','robinhood_crypto')),
        credential_fingerprint TEXT NOT NULL CHECK (length(credential_fingerprint) = 64),
        capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
        status TEXT NOT NULL CHECK (status IN ('active','attention_required','disconnected')),
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
        UNIQUE(profile_id, provider, credential_fingerprint)
      );
      CREATE INDEX profile_connections_v2_profile_provider
        ON profile_connections_v2(profile_id, provider, status);
      CREATE TRIGGER profile_connections_v2_identity_immutable
      BEFORE UPDATE OF id, profile_id, provider, credential_fingerprint, created_at ON profile_connections_v2
      BEGIN SELECT RAISE(ABORT, 'connection v2 identity is immutable'); END;

      CREATE TABLE provider_account_refs_v1 (
        id TEXT PRIMARY KEY CHECK (length(id) = 64), profile_id TEXT NOT NULL,
        connection_id TEXT NOT NULL REFERENCES profile_connections_v2(id),
        provider TEXT NOT NULL CHECK (provider IN ('coinbase','robinhood_crypto')),
        provider_identity_hash TEXT NOT NULL CHECK (length(provider_identity_hash) = 64),
        masked_display_suffix TEXT NOT NULL CHECK (length(masked_display_suffix) BETWEEN 4 AND 12),
        created_at INTEGER NOT NULL CHECK (created_at >= 0), UNIQUE(connection_id, provider_identity_hash)
      );
      CREATE INDEX provider_account_refs_v1_profile_connection
        ON provider_account_refs_v1(profile_id, connection_id);
      CREATE TRIGGER provider_account_refs_v1_no_update BEFORE UPDATE ON provider_account_refs_v1
      BEGIN SELECT RAISE(ABORT, 'provider account references are immutable'); END;
      CREATE TRIGGER provider_account_refs_v1_no_delete BEFORE DELETE ON provider_account_refs_v1
      BEGIN SELECT RAISE(ABORT, 'provider account references are immutable'); END;
      CREATE TRIGGER provider_account_refs_v1_profile_guard BEFORE INSERT ON provider_account_refs_v1
      WHEN (SELECT profile_id FROM profile_connections_v2 WHERE id = NEW.connection_id) <> NEW.profile_id
        OR (SELECT provider FROM profile_connections_v2 WHERE id = NEW.connection_id) <> NEW.provider
      BEGIN SELECT RAISE(ABORT, 'provider account ownership mismatch'); END;

      CREATE TABLE profile_connection_migration_links_v1 (
        v1_connection_id TEXT NOT NULL UNIQUE REFERENCES profile_connections_v1(id),
        v2_connection_id TEXT NOT NULL UNIQUE REFERENCES profile_connections_v2(id),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        PRIMARY KEY(v1_connection_id, v2_connection_id)
      );
      CREATE TRIGGER profile_connection_migration_links_v1_no_update BEFORE UPDATE ON profile_connection_migration_links_v1
      BEGIN SELECT RAISE(ABORT, 'connection migration links are immutable'); END;
      CREATE TRIGGER profile_connection_migration_links_v1_no_delete BEFORE DELETE ON profile_connection_migration_links_v1
      BEGIN SELECT RAISE(ABORT, 'connection migration links are immutable'); END;
    `);
  },
}];
