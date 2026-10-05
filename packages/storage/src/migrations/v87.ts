import type { Migration } from './types.js';

export const migrations87: readonly Migration[] = [{
  version: 87,
  name: 'connector_retirement_and_verified_wallet_identity',
  up(db) {
    db.exec(`
      CREATE TABLE connection_removals_v1 (
        connection_id TEXT PRIMARY KEY REFERENCES profile_connections_v2(id),
        profile_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','removed','reactivated')),
        requested_at INTEGER NOT NULL CHECK(requested_at>=0),
        updated_at INTEGER NOT NULL CHECK(updated_at>=requested_at)
      );
      CREATE TABLE connection_wallet_identities_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        profile_id TEXT NOT NULL,
        connection_id TEXT NOT NULL REFERENCES profile_connections_v2(id),
        provider TEXT NOT NULL CHECK(provider IN ('coinbase','robinhood_crypto')),
        identity_kind TEXT NOT NULL CHECK(identity_kind IN ('portfolio','account')),
        identity_hash TEXT NOT NULL CHECK(length(identity_hash)=64),
        canonical_key TEXT NOT NULL CHECK(length(canonical_key)=64),
        masked_suffix TEXT NOT NULL,
        verified_at INTEGER NOT NULL CHECK(verified_at>=0),
        UNIQUE(connection_id,canonical_key)
      );
      CREATE INDEX connection_wallet_identities_profile ON connection_wallet_identities_v1(profile_id,connection_id);
    `);
  },
}];
