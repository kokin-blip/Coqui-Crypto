import { buildUnifiedPortfolioSnapshotV2, sha256Hex, unifiedPortfolioSnapshotV2Hash, type ProfileConnectionV2 } from '@coqui/core';

import { type Db } from '../sqlite/index.js';
import { getLatestConnectionAccountSnapshotV2, getLatestUnifiedPortfolioSnapshotV2, listProfileConnectionsV2, saveUnifiedPortfolioSnapshotV2 } from './connections-v2.js';

export interface ConnectionRemoval {
  readonly connection_id: string;
  readonly profile_id: string;
  readonly command_id: string;
  readonly state: 'pending' | 'removed' | 'reactivated';
  readonly requested_at: number;
  readonly updated_at: number;
}
export function connectionRemoval(profileId: string, connectionId: string, db: Db): ConnectionRemoval | null {
  return db.prepare('SELECT * FROM connection_removals_v1 WHERE profile_id=? AND connection_id=?')
    .get(profileId, connectionId) as unknown as ConnectionRemoval | undefined ?? null;
}
export function connectionEligible(connection: ProfileConnectionV2, db: Db): boolean {
  const removal = connectionRemoval(connection.profileId, connection.id, db);
  return connection.status !== 'disconnected' && (removal === null || removal.state === 'reactivated');
}
export function setConnectionRemoval(connection: ProfileConnectionV2, commandId: string, state: ConnectionRemoval['state'], atMs: number, db: Db): void {
  db.prepare(`INSERT INTO connection_removals_v1(connection_id,profile_id,command_id,state,requested_at,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET command_id=excluded.command_id,
    state=excluded.state,updated_at=excluded.updated_at`).run(connection.id, connection.profileId, commandId, state, atMs, atMs);
}

export interface VerifiedWalletIdentity {
  readonly id: string;
  readonly profile_id: string;
  readonly connection_id: string;
  readonly provider: 'coinbase' | 'robinhood_crypto';
  readonly identity_kind: 'portfolio' | 'account';
  readonly identity_hash: string;
  readonly canonical_key: string;
  readonly masked_suffix: string;
  readonly verified_at: number;
}
export function saveVerifiedWalletIdentity(connection: ProfileConnectionV2, kind: VerifiedWalletIdentity['identity_kind'], identity: string, atMs: number, db: Db): void {
  const canonical = connection.provider === 'coinbase' ? identity.trim().toLowerCase() : identity.trim();
  if (!canonical) throw new TypeError('Verified wallet identity required.');
  const key = sha256Hex(`local-wallet-v1:${connection.provider}:${kind}:${sha256Hex(canonical)}`);
  const prior = listVerifiedWalletIdentities(connection.profileId, db).filter(w=>w.connection_id===connection.id);
  if (kind === 'portfolio' && prior.some(w=>w.canonical_key!==key)) throw new Error('Wallet identity changed.');
  db.prepare(`INSERT OR IGNORE INTO connection_wallet_identities_v1
    (id,profile_id,connection_id,provider,identity_kind,identity_hash,canonical_key,masked_suffix,verified_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(sha256Hex(`wallet-handle-v1:${connection.id}:${key}`), connection.profileId, connection.id,
      connection.provider, kind, sha256Hex(canonical), key, canonical.slice(-4).padStart(4, '•'), atMs);
}
export function listVerifiedWalletIdentities(profileId: string, db: Db): readonly VerifiedWalletIdentity[] {
  return db.prepare('SELECT * FROM connection_wallet_identities_v1 WHERE profile_id=? ORDER BY connection_id,id')
    .all(profileId) as unknown as VerifiedWalletIdentity[];
}

/** Current membership is resolved separately from immutable historical snapshot reads. */
export function getCurrentUnifiedPortfolioSnapshotV2(profileId: string, db: Db) {
  const eligible = listProfileConnectionsV2(profileId, db).filter(c=>connectionEligible(c, db));
  if (eligible.length === 0) return null;
  const snapshots = eligible.map(c=>getLatestConnectionAccountSnapshotV2(profileId,c.id,db)).filter(s=>s!==null);
  if (snapshots.length === 0) return null;
  const ids = snapshots.map(s=>s.id).sort();
  const historical = getLatestUnifiedPortfolioSnapshotV2(profileId,false,db);
  if (snapshots.length === eligible.length && historical !== null &&
    JSON.stringify([...historical.connectionSnapshotIds].sort()) === JSON.stringify(ids)) return historical;
  const built = buildUnifiedPortfolioSnapshotV2(profileId,snapshots,Math.min(...snapshots.map(s=>s.asOfMs)));
  const material = snapshots.length === eligible.length ? built : { ...built, complete:false, totalValueUsd:null };
  const contentHash = unifiedPortfolioSnapshotV2Hash(material);
  const current = { ...material, contentHash, id:sha256Hex(`unified-portfolio-snapshot-v2:${contentHash}`) };
  // A membership change is not a new balance/price observation.
  saveUnifiedPortfolioSnapshotV2(current,db,false);
  return current;
}
