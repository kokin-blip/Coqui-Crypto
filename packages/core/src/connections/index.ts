import { canonicalJson, type CanonicalJsonValue } from '../evidence/index.js';
import { sha256Hex } from '../crypto/sha256.js';
import type { InstrumentIdentity } from '../types/index.js';
import { Decimal } from 'decimal.js';

export type ConnectionProvider = 'coinbase';
export type ConnectionCapability = 'account_read' | 'market_read' | 'paper_route';
export type ConnectionStatus = 'active' | 'attention_required' | 'disconnected';

export interface ProfileConnection {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly provider: ConnectionProvider;
  readonly label: string;
  readonly externalIdentityHash: string;
  readonly capabilities: readonly ConnectionCapability[];
  readonly status: ConnectionStatus;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface SecretRef {
  readonly profileId: string;
  readonly connectionId: string | null;
  readonly provider: ConnectionProvider;
  readonly credentialType: 'api_credentials';
}

declare const assetExposureKeyBrand: unique symbol;
export type AssetExposureKey = string & { readonly [assetExposureKeyBrand]: true };

export function assetExposureKey(symbol: string): AssetExposureKey {
  const canonical = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/u.test(canonical)) {
    throw new TypeError('Invalid asset exposure identity.');
  }
  return canonical as AssetExposureKey;
}

export interface ConnectionAccountBalanceV1 {
  readonly exposureKey: AssetExposureKey;
  readonly instrument: InstrumentIdentity | null;
  readonly availableQuantity: string;
  readonly heldQuantity: string;
  readonly totalQuantity: string;
  readonly priceUsd: string | null;
  readonly valueUsd: string | null;
}

export interface ConnectionAccountSnapshotV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly connectionId: string;
  readonly provider: ConnectionProvider;
  readonly asOfMs: number;
  readonly balances: readonly ConnectionAccountBalanceV1[];
  readonly pendingOrderIds: readonly string[];
  readonly permissionMode: 'view_only' | 'unknown';
  readonly rulesHash: string | null;
  readonly health: 'healthy' | 'degraded' | 'unavailable';
  readonly complete: boolean;
  readonly contentHash: string;
}

export interface UnifiedExposureContributionV1 {
  readonly connectionId: string;
  readonly provider: ConnectionProvider;
  readonly instrument: InstrumentIdentity | null;
  readonly quantity: string;
  readonly valueUsd: string | null;
}

export interface UnifiedPortfolioExposureV1 {
  readonly exposureKey: AssetExposureKey;
  readonly quantity: string;
  readonly valueUsd: string | null;
  readonly contributions: readonly UnifiedExposureContributionV1[];
}

export interface UnifiedPortfolioSnapshot {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly asOfMs: number;
  readonly connectionSnapshotIds: readonly string[];
  readonly exposures: readonly UnifiedPortfolioExposureV1[];
  readonly totalValueUsd: string | null;
  readonly complete: boolean;
  readonly contentHash: string;
}

export function connectionEvidenceHash(value: unknown): string {
  return sha256Hex(canonicalJson(value as CanonicalJsonValue));
}

export function connectionAccountSnapshotHash(value: ConnectionAccountSnapshotV1): string {
  return connectionEvidenceHash({
    schemaVersion: value.schemaVersion, profileId: value.profileId,
    connectionId: value.connectionId, provider: value.provider, asOfMs: value.asOfMs,
    balances: value.balances, pendingOrderIds: value.pendingOrderIds,
    permissionMode: value.permissionMode, rulesHash: value.rulesHash,
    health: value.health, complete: value.complete,
  });
}

export function unifiedPortfolioSnapshotHash(value: UnifiedPortfolioSnapshot): string {
  return connectionEvidenceHash({
    schemaVersion: value.schemaVersion, profileId: value.profileId, asOfMs: value.asOfMs,
    connectionSnapshotIds: value.connectionSnapshotIds, exposures: value.exposures,
    totalValueUsd: value.totalValueUsd, complete: value.complete,
  });
}

export function buildUnifiedPortfolioSnapshot(
  profileId: string,
  snapshots: readonly ConnectionAccountSnapshotV1[],
  asOfMs: number,
): UnifiedPortfolioSnapshot {
  if (!profileId || !Number.isSafeInteger(asOfMs) || asOfMs < 0 || snapshots.length === 0) {
    throw new TypeError('A profile, time, and at least one connection snapshot are required.');
  }
  const snapshotIds = new Set<string>();
  const connectionIds = new Set<string>();
  const grouped = new Map<string, {
    quantity: Decimal;
    value: Decimal;
    complete: boolean;
    contributions: UnifiedExposureContributionV1[];
  }>();
  let complete = true;
  for (const snapshot of snapshots) {
    if (snapshot.profileId !== profileId || snapshotIds.has(snapshot.id) ||
        connectionIds.has(snapshot.connectionId) ||
        connectionAccountSnapshotHash(snapshot) !== snapshot.contentHash) {
      throw new TypeError('Connection snapshot identity or integrity is invalid.');
    }
    snapshotIds.add(snapshot.id);
    connectionIds.add(snapshot.connectionId);
    complete &&= snapshot.complete;
    for (const balance of snapshot.balances) {
      const quantity = new Decimal(balance.totalQuantity);
      const value = balance.valueUsd === null ? null : new Decimal(balance.valueUsd);
      if (quantity.isNegative() || !quantity.isFinite() || (value !== null && (!value.isFinite() || value.isNegative()))) {
        throw new TypeError('Connection balances must be finite and non-negative.');
      }
      const key = assetExposureKey(balance.exposureKey);
      const current = grouped.get(key) ?? {
        quantity: new Decimal(0), value: new Decimal(0), complete: true, contributions: [],
      };
      current.quantity = current.quantity.plus(quantity);
      if (value === null) current.complete = false;
      else current.value = current.value.plus(value);
      current.contributions.push(Object.freeze({
        connectionId: snapshot.connectionId,
        provider: snapshot.provider,
        instrument: balance.instrument,
        quantity: quantity.toString(),
        valueUsd: value?.toString() ?? null,
      }));
      grouped.set(key, current);
    }
  }
  const exposures = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => {
      item.contributions.sort((left, right) => left.connectionId.localeCompare(right.connectionId));
      complete &&= item.complete;
      return Object.freeze({
        exposureKey: assetExposureKey(key),
        quantity: item.quantity.toString(),
        valueUsd: item.complete ? item.value.toString() : null,
        contributions: Object.freeze(item.contributions),
      });
    });
  const totalValue = complete
    ? exposures.reduce((sum, exposure) => sum.plus(exposure.valueUsd ?? 0), new Decimal(0)).toString()
    : null;
  const content = {
    schemaVersion: 1 as const,
    profileId, asOfMs,
    connectionSnapshotIds: Object.freeze([...snapshotIds].sort()),
    exposures: Object.freeze(exposures), totalValueUsd: totalValue, complete,
  };
  const contentHash = connectionEvidenceHash(content);
  const snapshot: UnifiedPortfolioSnapshot = {
    ...content,
    id: sha256Hex(`unified-portfolio-snapshot-v1:${contentHash}`),
    contentHash,
  };
  return Object.freeze(snapshot);
}
