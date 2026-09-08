import {
  canonicalJson,
  connectionAccountSnapshotV2Hash,
  connectionV2Hash,
  nonNegativeDecimal,
  sha256Hex,
  unifiedPortfolioSnapshotV2Hash,
  type CanonicalJsonValue,
  type ConnectionAccountSnapshotV2,
  type ProfileConnectionV2,
  type ProviderAccountRefV1,
  type UnifiedPortfolioSnapshotV2,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

const SHA = /^[0-9a-f]{64}$/u;
const CAPABILITIES = new Set(['account_read', 'market_read', 'paper_route']);

function assertConnection(value: ProfileConnectionV2): void {
  if (value.schemaVersion !== 2 || !SHA.test(value.id) || !value.profileId ||
      !['coinbase', 'robinhood_crypto'].includes(value.provider) || !SHA.test(value.credentialFingerprint) ||
      !value.label || value.label.length > 80 || !value.capabilities.every((item) => CAPABILITIES.has(item)) ||
      new Set(value.capabilities).size !== value.capabilities.length ||
      !['active', 'attention_required', 'disconnected'].includes(value.status) ||
      !Number.isSafeInteger(value.createdAtMs) || !Number.isSafeInteger(value.updatedAtMs) ||
      value.createdAtMs < 0 || value.updatedAtMs < value.createdAtMs) throw new TypeError('Invalid profile connection v2.');
}

function connectionFromRow(row: Record<string, unknown>): ProfileConnectionV2 {
  const value: ProfileConnectionV2 = {
    schemaVersion: 2, id: String(row['id']), profileId: String(row['profile_id']),
    provider: row['provider'] as ProfileConnectionV2['provider'], label: String(row['label']),
    credentialFingerprint: String(row['credential_fingerprint']),
    capabilities: JSON.parse(String(row['capabilities_json'])) as ProfileConnectionV2['capabilities'],
    status: row['status'] as ProfileConnectionV2['status'],
    createdAtMs: Number(row['created_at']), updatedAtMs: Number(row['updated_at']),
  };
  assertConnection(value);
  return Object.freeze(value);
}

export function saveProfileConnectionV2(value: ProfileConnectionV2, database: Db): void {
  assertConnection(value);
  const existing = database.prepare('SELECT * FROM profile_connections_v2 WHERE id = ?').get(value.id) as Record<string, unknown> | undefined;
  if (existing !== undefined) {
    const prior = connectionFromRow(existing);
    if (prior.profileId !== value.profileId || prior.provider !== value.provider ||
        prior.credentialFingerprint !== value.credentialFingerprint || prior.createdAtMs !== value.createdAtMs ||
        prior.updatedAtMs > value.updatedAtMs) throw new Error('Connection v2 identity cannot change.');
  }
  database.prepare(`INSERT INTO profile_connections_v2
    (id, profile_id, provider, credential_fingerprint, capabilities_json, status, label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET capabilities_json=excluded.capabilities_json,
      status=excluded.status, label=excluded.label, updated_at=excluded.updated_at`)
    .run(value.id, value.profileId, value.provider, value.credentialFingerprint,
      canonicalJson([...value.capabilities].sort()), value.status, value.label, value.createdAtMs, value.updatedAtMs);
}

export function getProfileConnectionV2(profileId: string, id: string, database: Db): ProfileConnectionV2 | null {
  const row = database.prepare('SELECT * FROM profile_connections_v2 WHERE profile_id = ? AND id = ?')
    .get(profileId, id) as Record<string, unknown> | undefined;
  return row === undefined ? null : connectionFromRow(row);
}

export function listProfileConnectionsV2(profileId: string, database: Db): readonly ProfileConnectionV2[] {
  return Object.freeze((database.prepare(`SELECT * FROM profile_connections_v2 WHERE profile_id = ?
    ORDER BY provider, label, id`).all(profileId) as Record<string, unknown>[]).map(connectionFromRow));
}

export function linkProfileConnectionMigration(v1Id: string, v2Id: string, atMs: number, database: Db): void {
  database.prepare(`INSERT OR IGNORE INTO profile_connection_migration_links_v1
    (v1_connection_id, v2_connection_id, created_at) VALUES (?, ?, ?)`).run(v1Id, v2Id, atMs);
}

export function saveProviderAccountRef(value: ProviderAccountRefV1, database: Db): void {
  if (value.schemaVersion !== 1 || !SHA.test(value.id) || !SHA.test(value.providerIdentityHash) ||
      !value.maskedDisplaySuffix || value.maskedDisplaySuffix.length > 12 ||
      !Number.isSafeInteger(value.createdAtMs) || value.createdAtMs < 0 ||
      getProfileConnectionV2(value.profileId, value.connectionId, database)?.provider !== value.provider) {
    throw new TypeError('Invalid provider account reference.');
  }
  database.prepare(`INSERT OR IGNORE INTO provider_account_refs_v1
    (id, profile_id, connection_id, provider, provider_identity_hash, masked_display_suffix, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.profileId, value.connectionId, value.provider,
      value.providerIdentityHash, value.maskedDisplaySuffix, value.createdAtMs);
}

export function listProviderAccountRefs(profileId: string, connectionId: string, database: Db): readonly ProviderAccountRefV1[] {
  return Object.freeze((database.prepare(`SELECT * FROM provider_account_refs_v1
    WHERE profile_id = ? AND connection_id = ? ORDER BY id`).all(profileId, connectionId) as Record<string, unknown>[])
    .map((row) => Object.freeze({ schemaVersion: 1 as const, id: String(row['id']), profileId: String(row['profile_id']),
      connectionId: String(row['connection_id']), provider: row['provider'] as ProviderAccountRefV1['provider'],
      providerIdentityHash: String(row['provider_identity_hash']), maskedDisplaySuffix: String(row['masked_display_suffix']),
      createdAtMs: Number(row['created_at']) })));
}

function assertSnapshot(value: ConnectionAccountSnapshotV2, database: Db): void {
  if (value.schemaVersion !== 2 || !SHA.test(value.id) || !SHA.test(value.contentHash) ||
      connectionAccountSnapshotV2Hash(value) !== value.contentHash ||
      value.id !== sha256Hex(`connection-account-snapshot-v2:${value.contentHash}`) ||
      getProfileConnectionV2(value.profileId, value.connectionId, database)?.provider !== value.provider) {
    throw new TypeError('Invalid connection account snapshot v2.');
  }
}

export function saveConnectionAccountSnapshotV2(value: ConnectionAccountSnapshotV2, database: Db): void {
  assertSnapshot(value, database);
  const json = canonicalJson(value as unknown as CanonicalJsonValue);
  const existing = database.prepare('SELECT content_json FROM connection_account_snapshots_v2 WHERE id = ?')
    .get(value.id) as { content_json: string } | undefined;
  if (existing !== undefined) {
    if (existing.content_json !== json) throw new Error('Snapshot v2 identity cannot change.');
    return;
  }
  database.prepare(`INSERT INTO connection_account_snapshots_v2
    (id, profile_id, connection_id, provider, as_of, complete, health, content_json, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.profileId, value.connectionId, value.provider,
      value.asOfMs, value.complete ? 1 : 0, value.health, json, value.contentHash, value.asOfMs);
}

function snapshotFromJson(json: string): ConnectionAccountSnapshotV2 {
  const value = JSON.parse(json) as ConnectionAccountSnapshotV2;
  if (connectionAccountSnapshotV2Hash(value) !== value.contentHash) throw new Error('Stored snapshot v2 integrity failed.');
  return Object.freeze(value);
}

export function getLatestConnectionAccountSnapshotV2(profileId: string, connectionId: string, database: Db): ConnectionAccountSnapshotV2 | null {
  const row = database.prepare(`SELECT content_json FROM connection_account_snapshots_v2
    WHERE profile_id = ? AND connection_id = ? ORDER BY as_of DESC, id DESC LIMIT 1`)
    .get(profileId, connectionId) as { content_json: string } | undefined;
  return row === undefined ? null : snapshotFromJson(row.content_json);
}

export function saveUnifiedPortfolioSnapshotV2(value: UnifiedPortfolioSnapshotV2, database: Db): void {
  if (unifiedPortfolioSnapshotV2Hash(value) !== value.contentHash ||
      value.id !== sha256Hex(`unified-portfolio-snapshot-v2:${value.contentHash}`)) throw new TypeError('Invalid unified snapshot v2.');
  const json = canonicalJson(value as unknown as CanonicalJsonValue);
  const existing = database.prepare('SELECT content_json FROM unified_portfolio_snapshots_v2 WHERE id = ?')
    .get(value.id) as { content_json: string } | undefined;
  if (existing !== undefined) {
    if (existing.content_json !== json) throw new Error('Unified snapshot v2 identity cannot change.');
    return;
  }
  inTransaction(database, () => {
    database.prepare(`INSERT INTO unified_portfolio_snapshots_v2
      (id, profile_id, as_of, complete, content_json, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(value.id, value.profileId, value.asOfMs, value.complete ? 1 : 0, json, value.contentHash, value.asOfMs);
    const link = database.prepare(`INSERT INTO unified_portfolio_snapshot_sources_v2
      (unified_snapshot_id, connection_snapshot_id) VALUES (?, ?)`);
    for (const id of value.connectionSnapshotIds) link.run(value.id, id);
    if (value.complete && value.totalValueUsd !== null) {
      nonNegativeDecimal(value.totalValueUsd);
      const hash = connectionV2Hash({ profileId: value.profileId, unifiedSnapshotId: value.id,
        observedAtMs: value.asOfMs, totalValueUsd: value.totalValueUsd });
      database.prepare(`INSERT INTO portfolio_valuation_observations_v1
        (id, profile_id, unified_snapshot_id, observed_at, total_value_usd_text, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sha256Hex(`portfolio-valuation-v1:${hash}`), value.profileId,
        value.id, value.asOfMs, value.totalValueUsd, hash, value.asOfMs);
    }
  });
}

function unifiedFromJson(json: string): UnifiedPortfolioSnapshotV2 {
  const value = JSON.parse(json) as UnifiedPortfolioSnapshotV2;
  if (unifiedPortfolioSnapshotV2Hash(value) !== value.contentHash) throw new Error('Stored unified snapshot v2 integrity failed.');
  return Object.freeze(value);
}

export function getLatestUnifiedPortfolioSnapshotV2(profileId: string, completeOnly: boolean, database: Db): UnifiedPortfolioSnapshotV2 | null {
  const row = database.prepare(`SELECT content_json FROM unified_portfolio_snapshots_v2
    WHERE profile_id = ? AND (? = 0 OR complete = 1) ORDER BY as_of DESC, id DESC LIMIT 1`)
    .get(profileId, completeOnly ? 1 : 0) as { content_json: string } | undefined;
  return row === undefined ? null : unifiedFromJson(row.content_json);
}

export function listPortfolioValuationObservations(profileId: string, database: Db): readonly { observedAtMs: number; totalValueUsd: string; unifiedSnapshotId: string }[] {
  return Object.freeze((database.prepare(`SELECT observed_at, total_value_usd_text, unified_snapshot_id
    FROM portfolio_valuation_observations_v1 WHERE profile_id = ? ORDER BY observed_at, id`)
    .all(profileId) as Record<string, unknown>[]).map((row) => Object.freeze({ observedAtMs: Number(row['observed_at']),
      totalValueUsd: String(row['total_value_usd_text']), unifiedSnapshotId: String(row['unified_snapshot_id']) })));
}
