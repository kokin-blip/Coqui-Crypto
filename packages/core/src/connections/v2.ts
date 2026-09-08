import { Decimal } from 'decimal.js';

import { sha256Hex } from '../crypto/sha256.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/index.js';
import type { InstrumentIdentity } from '../types/index.js';
import type { AssetExposureKey, ConnectionCapability } from './index.js';

export type ConnectionProviderV2 = 'coinbase' | 'robinhood_crypto';

export interface ProfileConnectionV2 {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly profileId: string;
  readonly provider: ConnectionProviderV2;
  readonly credentialFingerprint: string;
  readonly capabilities: readonly ConnectionCapability[];
  readonly status: 'active' | 'attention_required' | 'disconnected';
  readonly label: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface ProviderAccountRefV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly connectionId: string;
  readonly provider: ConnectionProviderV2;
  readonly providerIdentityHash: string;
  readonly maskedDisplaySuffix: string;
  readonly createdAtMs: number;
}

export interface SecretRefV2 {
  readonly schemaVersion: 2;
  readonly profileId: string;
  readonly connectionId: string;
  readonly provider: ConnectionProviderV2;
  readonly credentialType: 'api_credentials';
}

export interface ConnectionAccountBalanceV2 {
  readonly accountRefId: string;
  readonly exposureKey: AssetExposureKey;
  readonly instrument: InstrumentIdentity | null;
  readonly availableQuantity: string;
  readonly heldQuantity: string;
  readonly totalQuantity: string;
  readonly priceUsd: string | null;
  readonly valueUsd: string | null;
}

export interface ConnectionAccountSnapshotV2 {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly profileId: string;
  readonly connectionId: string;
  readonly provider: ConnectionProviderV2;
  readonly asOfMs: number;
  readonly balances: readonly ConnectionAccountBalanceV2[];
  readonly cashUsd: string | null;
  readonly buyingPowerUsd: string | null;
  readonly pendingOrderIds: readonly string[];
  readonly permissions: {
    readonly accountRead: boolean;
    readonly marketRead: boolean;
    readonly orderRead: boolean;
    readonly trade: false;
  };
  readonly rulesHash: string | null;
  readonly feeEvidenceHash: string | null;
  readonly health: 'healthy' | 'degraded' | 'unavailable';
  readonly failureReason: string | null;
  readonly complete: boolean;
  readonly provenance: {
    readonly source: ConnectionProviderV2;
    readonly requestedAtMs: number;
    readonly receivedAtMs: number;
  };
  readonly contentHash: string;
}

export interface UnifiedExposureContributionV2 {
  readonly connectionId: string;
  readonly accountRefId: string;
  readonly provider: ConnectionProviderV2;
  readonly instrument: InstrumentIdentity | null;
  readonly quantity: string;
  readonly valueUsd: string | null;
}

export interface UnifiedPortfolioSnapshotV2 {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly profileId: string;
  readonly asOfMs: number;
  readonly connectionSnapshotIds: readonly string[];
  readonly exposures: readonly {
    readonly exposureKey: AssetExposureKey;
    readonly quantity: string;
    readonly valueUsd: string | null;
    readonly contributions: readonly UnifiedExposureContributionV2[];
  }[];
  readonly totalValueUsd: string | null;
  readonly complete: boolean;
  readonly contentHash: string;
}

export function connectionV2Hash(value: unknown): string {
  return sha256Hex(canonicalJson(value as CanonicalJsonValue));
}

function canonicalExposureKey(value: string): AssetExposureKey {
  const canonical = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/u.test(canonical)) {
    throw new TypeError('Invalid asset exposure identity.');
  }
  return canonical as AssetExposureKey;
}

export function profileConnectionV2(
  profileId: string,
  provider: ConnectionProviderV2,
  credentialFingerprint: string,
  atMs: number,
  label = provider === 'coinbase' ? 'Coinbase' : 'Robinhood Crypto',
): ProfileConnectionV2 {
  const id = sha256Hex(`profile-connection-v2:${profileId}:${provider}:${credentialFingerprint}`);
  return Object.freeze({
    schemaVersion: 2, id, profileId, provider, credentialFingerprint,
    capabilities: Object.freeze(['account_read', 'market_read', 'paper_route'] as const),
    status: 'active', label, createdAtMs: atMs, updatedAtMs: atMs,
  });
}

export function providerAccountRefV1(
  connection: ProfileConnectionV2,
  providerIdentity: string,
  atMs: number,
): ProviderAccountRefV1 {
  const providerIdentityHash = sha256Hex(providerIdentity);
  return Object.freeze({
    schemaVersion: 1,
    id: sha256Hex(`provider-account-ref-v1:${connection.id}:${providerIdentityHash}`),
    profileId: connection.profileId, connectionId: connection.id, provider: connection.provider,
    providerIdentityHash, maskedDisplaySuffix: providerIdentity.slice(-4).padStart(4, '•'),
    createdAtMs: atMs,
  });
}

export function connectionAccountSnapshotV2Hash(value: ConnectionAccountSnapshotV2): string {
  const content = { ...value } as Record<string, unknown>;
  Reflect.deleteProperty(content, 'id');
  Reflect.deleteProperty(content, 'contentHash');
  return connectionV2Hash(content);
}

export function unifiedPortfolioSnapshotV2Hash(value: UnifiedPortfolioSnapshotV2): string {
  const content = { ...value } as Record<string, unknown>;
  Reflect.deleteProperty(content, 'id');
  Reflect.deleteProperty(content, 'contentHash');
  return connectionV2Hash(content);
}

/** Aggregate current account evidence without ever consulting tax-lot quantities. */
export function buildUnifiedPortfolioSnapshotV2(
  profileId: string,
  snapshots: readonly ConnectionAccountSnapshotV2[],
  asOfMs: number,
): UnifiedPortfolioSnapshotV2 {
  if (snapshots.length === 0) throw new TypeError('At least one connection snapshot is required.');
  const ids = new Set<string>(), connections = new Set<string>();
  const grouped = new Map<string, { quantity: Decimal; value: Decimal; complete: boolean; contributions: UnifiedExposureContributionV2[] }>();
  let complete = true;
  for (const snapshot of snapshots) {
    if (snapshot.profileId !== profileId || ids.has(snapshot.id) || connections.has(snapshot.connectionId) ||
        connectionAccountSnapshotV2Hash(snapshot) !== snapshot.contentHash) {
      throw new TypeError('Connection snapshot identity or integrity is invalid.');
    }
    ids.add(snapshot.id); connections.add(snapshot.connectionId); complete &&= snapshot.complete;
    for (const balance of snapshot.balances) {
      const quantity = new Decimal(balance.totalQuantity);
      const value = balance.valueUsd === null ? null : new Decimal(balance.valueUsd);
      const key = canonicalExposureKey(balance.exposureKey);
      const current = grouped.get(key) ?? { quantity: new Decimal(0), value: new Decimal(0), complete: true, contributions: [] };
      current.quantity = current.quantity.plus(quantity);
      if (value === null) current.complete = false; else current.value = current.value.plus(value);
      current.contributions.push(Object.freeze({
        connectionId: snapshot.connectionId, accountRefId: balance.accountRefId,
        provider: snapshot.provider, instrument: balance.instrument,
        quantity: quantity.toString(), valueUsd: value?.toString() ?? null,
      }));
      grouped.set(key, current);
    }
  }
  const exposures = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => {
    item.contributions.sort((a, b) => a.connectionId.localeCompare(b.connectionId) || a.accountRefId.localeCompare(b.accountRefId));
    complete &&= item.complete;
    return Object.freeze({ exposureKey: canonicalExposureKey(key), quantity: item.quantity.toString(),
      valueUsd: item.complete ? item.value.toString() : null, contributions: Object.freeze(item.contributions) });
  });
  const totalValueUsd = complete
    ? exposures.reduce((sum, exposure) => sum.plus(exposure.valueUsd ?? '0'), new Decimal(0)).toString()
    : null;
  const material = { schemaVersion: 2 as const, profileId, asOfMs,
    connectionSnapshotIds: Object.freeze([...ids].sort()), exposures: Object.freeze(exposures),
    totalValueUsd, complete };
  const contentHash = connectionV2Hash(material);
  return Object.freeze({ ...material, id: sha256Hex(`unified-portfolio-snapshot-v2:${contentHash}`), contentHash });
}
