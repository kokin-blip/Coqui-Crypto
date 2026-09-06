import {
  canonicalJson,
  connectionAccountSnapshotHash,
  sha256Hex,
  unifiedPortfolioSnapshotHash,
  type ConnectionAccountSnapshotV1,
  type CanonicalJsonValue,
  type ProfileConnection,
  type UnifiedPortfolioSnapshot,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CAPABILITIES = new Set(['account_read', 'market_read', 'paper_route']);

function assertConnection(value: ProfileConnection): void {
  if (value.schemaVersion !== 1 || !ID.test(value.id) || !value.profileId ||
      value.provider !== 'coinbase' || !value.label || value.label.length > 80 ||
      !SHA256.test(value.externalIdentityHash) ||
      !value.capabilities.every((capability) => CAPABILITIES.has(capability)) ||
      new Set(value.capabilities).size !== value.capabilities.length ||
      !['active', 'attention_required', 'disconnected'].includes(value.status) ||
      !Number.isSafeInteger(value.createdAtMs) || value.createdAtMs < 0 ||
      !Number.isSafeInteger(value.updatedAtMs) || value.updatedAtMs < value.createdAtMs) {
    throw new TypeError('Invalid profile connection.');
  }
}

export function saveProfileConnection(value: ProfileConnection, database: Db): void {
  assertConnection(value);
  const existing = database.prepare(`SELECT profile_id, provider, external_identity_hash, created_at
    FROM profile_connections_v1 WHERE id = ?`).get(value.id) as Record<string, unknown> | undefined;
  if (existing !== undefined && (existing['profile_id'] !== value.profileId ||
      existing['provider'] !== value.provider ||
      existing['external_identity_hash'] !== value.externalIdentityHash ||
      Number(existing['created_at']) !== value.createdAtMs)) {
    throw new Error('Connection identity cannot change.');
  }
  if (existing !== undefined) {
    const current = database.prepare('SELECT updated_at FROM profile_connections_v1 WHERE id = ?')
      .get(value.id) as { updated_at: number | bigint };
    if (Number(current.updated_at) > value.updatedAtMs) {
      throw new Error('Connection metadata cannot move backward in time.');
    }
  }
  database.prepare(`
    INSERT INTO profile_connections_v1
      (id, profile_id, provider, label, external_identity_hash, capabilities_json,
       status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET label = excluded.label,
      capabilities_json = excluded.capabilities_json,
      status = excluded.status, updated_at = excluded.updated_at
  `).run(value.id, value.profileId, value.provider, value.label,
    value.externalIdentityHash, canonicalJson([...value.capabilities].sort()),
    value.status, value.createdAtMs, value.updatedAtMs);
}

function connectionFromRow(row: Record<string, unknown>): ProfileConnection {
  const value = {
    schemaVersion: 1 as const,
    id: row['id'] as string,
    profileId: row['profile_id'] as string,
    provider: row['provider'] as 'coinbase',
    label: row['label'] as string,
    externalIdentityHash: row['external_identity_hash'] as string,
    capabilities: JSON.parse(row['capabilities_json'] as string) as ProfileConnection['capabilities'],
    status: row['status'] as ProfileConnection['status'],
    createdAtMs: Number(row['created_at']), updatedAtMs: Number(row['updated_at']),
  };
  assertConnection(value);
  return Object.freeze(value);
}

export function getProfileConnection(profileId: string, id: string, database: Db): ProfileConnection | null {
  const row = database.prepare(`SELECT * FROM profile_connections_v1 WHERE id = ? AND profile_id = ?`)
    .get(id, profileId) as Record<string, unknown> | undefined;
  return row === undefined ? null : connectionFromRow(row);
}

export function listProfileConnections(profileId: string, database: Db): readonly ProfileConnection[] {
  return Object.freeze((database.prepare(`
    SELECT * FROM profile_connections_v1 WHERE profile_id = ? ORDER BY provider, label, id
  `).all(profileId) as Record<string, unknown>[]).map(connectionFromRow));
}

export function legacyCoinbaseConnection(
  profileId: string,
  externalIdentityHash: string,
  atMs: number,
): ProfileConnection {
  if (!SHA256.test(externalIdentityHash) || !Number.isSafeInteger(atMs) || atMs < 0) {
    throw new TypeError('Invalid legacy Coinbase connection evidence.');
  }
  return Object.freeze({
    schemaVersion: 1,
    id: sha256Hex(`profile-connection-v1:${profileId}:coinbase:${externalIdentityHash}`),
    profileId, provider: 'coinbase', label: 'Coinbase', externalIdentityHash,
    capabilities: Object.freeze(['account_read', 'market_read', 'paper_route'] as const),
    status: 'active', createdAtMs: atMs, updatedAtMs: atMs,
  });
}

/** Idempotent lazy materialization of the predecessor's singular Coinbase identity. */
export function ensureLegacyCoinbaseConnection(
  profileId: string,
  externalIdentityHash: string,
  atMs: number,
  database: Db,
): ProfileConnection {
  const candidate = legacyCoinbaseConnection(profileId, externalIdentityHash, atMs);
  const existing = getProfileConnection(profileId, candidate.id, database);
  if (existing !== null) return existing;
  saveProfileConnection(candidate, database);
  return candidate;
}

function assertAccountSnapshot(value: ConnectionAccountSnapshotV1): void {
  if (value.schemaVersion !== 1 || !SHA256.test(value.id) || !value.profileId || !ID.test(value.connectionId) ||
      value.provider !== 'coinbase' || !Number.isSafeInteger(value.asOfMs) || value.asOfMs < 0 ||
      !['view_only', 'unknown'].includes(value.permissionMode) ||
      !['healthy', 'degraded', 'unavailable'].includes(value.health) ||
      (value.rulesHash !== null && !SHA256.test(value.rulesHash)) ||
      !SHA256.test(value.contentHash) || connectionAccountSnapshotHash(value) !== value.contentHash ||
      value.id !== sha256Hex(`connection-account-snapshot-v1:${value.contentHash}`)) {
    throw new TypeError('Invalid connection account snapshot.');
  }
  if (new Set(value.pendingOrderIds).size !== value.pendingOrderIds.length ||
      value.pendingOrderIds.some((id) => !ID.test(id))) {
    throw new TypeError('Invalid pending-order evidence.');
  }
  for (const balance of value.balances) {
    if (!balance.exposureKey ||
        ![balance.availableQuantity, balance.heldQuantity, balance.totalQuantity]
          .every((amount) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(amount)) ||
        (balance.priceUsd !== null && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance.priceUsd)) ||
        (balance.valueUsd !== null && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(balance.valueUsd)) ||
        (balance.instrument !== null && balance.instrument.venue !== value.provider)) {
      throw new TypeError('Invalid connection balance evidence.');
    }
  }
}

export function saveConnectionAccountSnapshot(value: ConnectionAccountSnapshotV1, database: Db): void {
  assertAccountSnapshot(value);
  if (getProfileConnection(value.profileId, value.connectionId, database) === null) {
    throw new TypeError('Connection does not belong to this profile.');
  }
  const contentJson = canonicalJson(value as unknown as CanonicalJsonValue);
  const existing = database.prepare(`SELECT content_json FROM connection_account_snapshots_v1 WHERE id = ?`)
    .get(value.id) as { content_json: string } | undefined;
  if (existing !== undefined) {
    if (existing.content_json !== contentJson) throw new Error('Snapshot identity cannot change content.');
    return;
  }
  database.prepare(`INSERT INTO connection_account_snapshots_v1
    (id, profile_id, connection_id, provider, as_of, complete, health, content_json, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(value.id, value.profileId, value.connectionId, value.provider, value.asOfMs,
      value.complete ? 1 : 0, value.health, contentJson, value.contentHash, value.asOfMs);
}

export function getConnectionAccountSnapshot(id: string, database: Db): ConnectionAccountSnapshotV1 | null {
  const row = database.prepare(`SELECT content_json FROM connection_account_snapshots_v1 WHERE id = ?`)
    .get(id) as { content_json: string } | undefined;
  if (row === undefined) return null;
  const value = JSON.parse(row.content_json) as ConnectionAccountSnapshotV1;
  assertAccountSnapshot(value);
  if (canonicalJson(value as unknown as CanonicalJsonValue) !== row.content_json) {
    throw new Error('Stored connection snapshot integrity failed.');
  }
  return Object.freeze(value);
}

export function saveUnifiedPortfolioSnapshot(value: UnifiedPortfolioSnapshot, database: Db): void {
  if (value.schemaVersion !== 1 || !SHA256.test(value.id) || !value.profileId ||
      !Number.isSafeInteger(value.asOfMs) || value.asOfMs < 0 || !SHA256.test(value.contentHash) ||
      unifiedPortfolioSnapshotHash(value) !== value.contentHash ||
      value.id !== sha256Hex(`unified-portfolio-snapshot-v1:${value.contentHash}`)) {
    throw new TypeError('Invalid unified portfolio snapshot.');
  }
  if (value.connectionSnapshotIds.length === 0 ||
      new Set(value.connectionSnapshotIds).size !== value.connectionSnapshotIds.length ||
      [...value.connectionSnapshotIds].sort().some((id, index) => id !== value.connectionSnapshotIds[index]) ||
      (value.complete && value.totalValueUsd === null)) {
    throw new TypeError('Invalid unified portfolio source set.');
  }
  const sourceConnections = new Set<string>();
  for (const snapshotId of value.connectionSnapshotIds) {
    const source = getConnectionAccountSnapshot(snapshotId, database);
    if (source === null || source.profileId !== value.profileId) {
      throw new TypeError('Unified snapshot source does not belong to this profile.');
    }
    sourceConnections.add(source.connectionId);
  }
  let previousExposure = '';
  for (const exposure of value.exposures) {
    if (!exposure.exposureKey || exposure.exposureKey <= previousExposure ||
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(exposure.quantity) ||
        (exposure.valueUsd !== null && !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(exposure.valueUsd)) ||
        exposure.contributions.length === 0 ||
        exposure.contributions.some((item) => !sourceConnections.has(item.connectionId))) {
      throw new TypeError('Invalid unified portfolio exposure.');
    }
    previousExposure = exposure.exposureKey;
  }
  const contentJson = canonicalJson(value as unknown as CanonicalJsonValue);
  const existing = database.prepare(`SELECT content_json FROM unified_portfolio_snapshots_v1 WHERE id = ?`)
    .get(value.id) as { content_json: string } | undefined;
  if (existing !== undefined) {
    if (existing.content_json !== contentJson) throw new Error('Unified snapshot identity cannot change content.');
    return;
  }
  inTransaction(database, () => {
    database.prepare(`INSERT INTO unified_portfolio_snapshots_v1
      (id, profile_id, as_of, complete, content_json, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(value.id, value.profileId, value.asOfMs, value.complete ? 1 : 0,
        contentJson, value.contentHash, value.asOfMs);
    const link = database.prepare(`INSERT INTO unified_portfolio_snapshot_connections_v1
      (unified_snapshot_id, connection_snapshot_id) VALUES (?, ?)`);
    for (const sourceId of value.connectionSnapshotIds) link.run(value.id, sourceId);
  });
}

export function getUnifiedPortfolioSnapshot(id: string, database: Db): UnifiedPortfolioSnapshot | null {
  const row = database.prepare(`SELECT content_json FROM unified_portfolio_snapshots_v1 WHERE id = ?`)
    .get(id) as { content_json: string } | undefined;
  if (row === undefined) return null;
  const value = JSON.parse(row.content_json) as UnifiedPortfolioSnapshot;
  if (unifiedPortfolioSnapshotHash(value) !== value.contentHash ||
      canonicalJson(value as unknown as CanonicalJsonValue) !== row.content_json) {
    throw new Error('Stored unified portfolio snapshot integrity failed.');
  }
  return Object.freeze(value);
}
