import { Decimal } from 'decimal.js';

import {
  assetExposureKey,
  buildUnifiedPortfolioSnapshot,
  connectionAccountSnapshotHash,
  sha256Hex,
  type ConnectionAccountBalanceV1,
  type ConnectionAccountSnapshotV1,
  type CoinbaseAccountEvidence,
  type ProfileConnection,
  type SecretRef,
  type UnifiedPortfolioSnapshot,
} from '@coqui/core';
import {
  migrateLegacyConnectionSecret,
  parseStoredCoinbaseCredentials,
  readConnectionSecret,
  validateCoinbaseCredentials,
  type CoinbaseCredentials,
  type SecretStore,
} from '@coqui/adapters';
import {
  listProfileConnections,
  saveConnectionAccountSnapshot,
  saveUnifiedPortfolioSnapshot,
  type Db,
} from '@coqui/storage';

export interface ConnectionAccountSnapshotProvider {
  readonly provider: 'coinbase';
  acquire(
    connection: ProfileConnection,
    secretRef: SecretRef,
    signal?: AbortSignal,
  ): Promise<ConnectionAccountSnapshotV1>;
}

export interface CoinbaseSnapshotAcquirer {
  acquire(credentials: CoinbaseCredentials, signal?: AbortSignal): Promise<{
    readonly accounts: readonly CoinbaseAccountEvidence[];
    readonly pendingOrderIds: readonly string[];
    readonly rulesHash: string | null;
  }>;
}

export type AccountPriceResolver = (
  currency: string,
) => { readonly productId: string; readonly priceUsd: string } | null;

export interface CoinbaseAccountSnapshotProviderDependencies {
  readonly secretStore: SecretStore;
  readonly acquirer: CoinbaseSnapshotAcquirer;
  readonly resolvePrice: AccountPriceResolver;
  readonly nowMs: () => number;
  /** Only an explicit legacy-access workflow may request destructive key-name migration. */
  readonly migrateLegacySecret?: boolean;
}

export function createCoinbaseAccountSnapshotProvider(
  dependencies: CoinbaseAccountSnapshotProviderDependencies,
): ConnectionAccountSnapshotProvider {
  return Object.freeze({
    provider: 'coinbase' as const,
    async acquire(connection: ProfileConnection, secretRef: SecretRef, signal?: AbortSignal) {
      if (connection.profileId !== secretRef.profileId || connection.id !== secretRef.connectionId ||
          connection.provider !== secretRef.provider || signal?.aborted) {
        throw new TypeError('Connection credential ownership check failed.');
      }
      const stored = dependencies.migrateLegacySecret
        ? await migrateLegacyConnectionSecret(dependencies.secretStore, secretRef)
        : await readConnectionSecret(dependencies.secretStore, secretRef);
      if (!stored.ok || stored.value === null) throw new Error('connection_credentials_unavailable');
      const credentials = parseStoredCoinbaseCredentials(stored.value);
      if (credentials === null || !validateCoinbaseCredentials(credentials).ok) {
        throw new Error('connection_credentials_invalid');
      }
      const facts = await dependencies.acquirer.acquire(credentials, signal);
      const atMs = dependencies.nowMs();
      return coinbaseConnectionAccountSnapshot(
        connection, facts.accounts, facts.pendingOrderIds, facts.rulesHash,
        atMs, dependencies.resolvePrice,
      );
    },
  });
}

/** Convert provider facts into the provider-neutral, immutable account snapshot contract. */
export function coinbaseConnectionAccountSnapshot(
  connection: ProfileConnection,
  accounts: readonly CoinbaseAccountEvidence[],
  pendingOrderIds: readonly string[],
  rulesHash: string | null,
  asOfMs: number,
  resolvePrice: AccountPriceResolver,
): ConnectionAccountSnapshotV1 {
  if (connection.provider !== 'coinbase' || !Number.isSafeInteger(asOfMs) || asOfMs < 0) {
    throw new TypeError('Invalid Coinbase snapshot request.');
  }
  let complete = rulesHash !== null;
  const balances: ConnectionAccountBalanceV1[] = accounts
    .filter((account) => new Decimal(account.totalQuantity).gt(0))
    .sort((left, right) => left.currency.localeCompare(right.currency))
    .map((account) => {
      const quote = account.currency === 'USD'
        ? { productId: 'USD-USD', priceUsd: '1' }
        : resolvePrice(account.currency);
      if (quote === null) complete = false;
      const price = quote?.priceUsd ?? null;
      const value = price === null ? null : new Decimal(account.totalQuantity).mul(price).toString();
      return Object.freeze({
        exposureKey: assetExposureKey(account.currency),
        instrument: quote === null ? null : {
          venue: 'coinbase' as const, productId: quote.productId, productType: 'spot' as const,
        },
        availableQuantity: String(account.availableQuantity), heldQuantity: String(account.holdQuantity),
        totalQuantity: String(account.totalQuantity), priceUsd: price, valueUsd: value,
      });
    });
  const material = {
    schemaVersion: 1 as const,
    profileId: connection.profileId, connectionId: connection.id, provider: 'coinbase' as const,
    asOfMs, balances: Object.freeze(balances), pendingOrderIds: Object.freeze([...pendingOrderIds].sort()),
    permissionMode: 'view_only' as const, rulesHash,
    health: complete ? 'healthy' as const : 'degraded' as const, complete,
  };
  const contentHash = connectionAccountSnapshotHash({ ...material, id: '', contentHash: '' });
  return Object.freeze({
    ...material,
    id: sha256Hex(`connection-account-snapshot-v1:${contentHash}`),
    contentHash,
  });
}

function unavailableSnapshot(connection: ProfileConnection, asOfMs: number): ConnectionAccountSnapshotV1 {
  const material = {
    schemaVersion: 1 as const, profileId: connection.profileId, connectionId: connection.id,
    provider: connection.provider, asOfMs, balances: Object.freeze([]),
    pendingOrderIds: Object.freeze([]), permissionMode: 'unknown' as const,
    rulesHash: null, health: 'unavailable' as const, complete: false,
  };
  const contentHash = connectionAccountSnapshotHash({ ...material, id: '', contentHash: '' });
  return Object.freeze({
    ...material, id: sha256Hex(`connection-account-snapshot-v1:${contentHash}`), contentHash,
  });
}

export interface ConnectionPortfolioSnapshotServiceDependencies {
  readonly database: Db;
  readonly providers: readonly ConnectionAccountSnapshotProvider[];
  readonly nowMs: () => number;
}

/** Host-owned orchestration; providers cannot write evidence or combine profiles. */
export class ConnectionPortfolioSnapshotService {
  readonly #database: Db;
  readonly #providers: ReadonlyMap<string, ConnectionAccountSnapshotProvider>;
  readonly #nowMs: () => number;

  constructor(dependencies: ConnectionPortfolioSnapshotServiceDependencies) {
    this.#database = dependencies.database;
    this.#providers = new Map(dependencies.providers.map((provider) => [provider.provider, provider]));
    this.#nowMs = dependencies.nowMs;
  }

  async refresh(profileId: string, signal?: AbortSignal): Promise<UnifiedPortfolioSnapshot> {
    const connections = listProfileConnections(profileId, this.#database)
      .filter((connection) => connection.status !== 'disconnected');
    if (connections.length === 0) throw new Error('profile_connections_unavailable');
    const asOfMs = this.#nowMs();
    if (!Number.isSafeInteger(asOfMs) || asOfMs < 0) throw new Error('connection_clock_unavailable');
    const snapshots: ConnectionAccountSnapshotV1[] = [];
    for (const connection of connections) {
      const provider = this.#providers.get(connection.provider);
      let snapshot: ConnectionAccountSnapshotV1;
      try {
        if (provider === undefined) throw new Error('connection_provider_unavailable');
        snapshot = await provider.acquire(connection, {
          profileId, connectionId: connection.id, provider: connection.provider,
          credentialType: 'api_credentials',
        }, signal);
      } catch {
        snapshot = unavailableSnapshot(connection, asOfMs);
      }
      saveConnectionAccountSnapshot(snapshot, this.#database);
      snapshots.push(snapshot);
    }
    const unified = buildUnifiedPortfolioSnapshot(profileId, snapshots, asOfMs);
    saveUnifiedPortfolioSnapshot(unified, this.#database);
    return unified;
  }
}
