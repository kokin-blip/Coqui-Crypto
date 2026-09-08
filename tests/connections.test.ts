import { describe, expect, it } from 'vitest';

import {
  createMemorySecretStore,
  serializeCoinbaseCredentials,
  writeConnectionSecret,
} from '../packages/adapters/src/index.js';
import {
  buildUnifiedPortfolioSnapshot,
  buildUnifiedPortfolioSnapshotV2,
  connectionAccountSnapshotV2Hash,
  decimal,
  profileConnectionV2,
  providerAccountRefV1,
  sha256Hex,
} from '../packages/core/src/index.js';
import {
  coinbaseConnectionAccountSnapshot,
  ConnectionPortfolioSnapshotService,
  createCoinbaseAccountSnapshotProvider,
} from '../packages/services/src/index.js';
import {
  getConnectionAccountSnapshot,
  getLatestUnifiedPortfolioSnapshotV2,
  getProfileConnection,
  getUnifiedPortfolioSnapshot,
  ensureLegacyCoinbaseConnection,
  legacyCoinbaseConnection,
  listProfileConnections,
  listPortfolioValuationObservations,
  listProfileConnectionsV2,
  saveConnectionAccountSnapshotV2,
  saveProfileConnectionV2,
  saveProviderAccountRef,
  saveUnifiedPortfolioSnapshotV2,
  openDatabase,
  saveConnectionAccountSnapshot,
  saveProfileConnection,
  saveUnifiedPortfolioSnapshot,
} from '../packages/storage/src/index.js';

function account(currency: string, quantity: string) {
  return Object.freeze({
    accountUuid: `account-${currency}`, currency,
    availableQuantity: decimal(quantity), holdQuantity: decimal('0'),
    totalQuantity: decimal(quantity), active: true, ready: true,
    defaultAccount: true, providerUpdatedAtMs: 10,
  });
}

describe('profile connections and unified portfolio evidence', () => {
  it('persists versioned connection and authoritative portfolio evidence without tax lots', () => {
    const database = openDatabase(':memory:');
    const connection = profileConnectionV2('profile-a', 'coinbase', sha256Hex('credential'), 10);
    saveProfileConnectionV2(connection, database);
    const accountRef = providerAccountRefV1(connection, 'provider-account-1234', 10);
    saveProviderAccountRef(accountRef, database);
    const material = {
      schemaVersion: 2 as const, profileId: 'profile-a', connectionId: connection.id,
      provider: 'coinbase' as const, asOfMs: 20,
      balances: [{ accountRefId: accountRef.id, exposureKey: 'BTC' as never,
        instrument: { venue: 'coinbase' as const, productId: 'BTC-USD', productType: 'spot' as const },
        availableQuantity: '1', heldQuantity: '0', totalQuantity: '1', priceUsd: '50000', valueUsd: '50000' }],
      cashUsd: '0', buyingPowerUsd: '0', pendingOrderIds: [],
      permissions: { accountRead: true, marketRead: true, orderRead: true, trade: false as const },
      rulesHash: null, feeEvidenceHash: null, health: 'healthy' as const,
      failureReason: null, complete: true,
      provenance: { source: 'coinbase' as const, requestedAtMs: 19, receivedAtMs: 20 },
    };
    const hash = connectionAccountSnapshotV2Hash({ ...material, id: '', contentHash: '' });
    const snapshot = { ...material, id: sha256Hex(`connection-account-snapshot-v2:${hash}`), contentHash: hash };
    saveConnectionAccountSnapshotV2(snapshot, database);
    const unified = buildUnifiedPortfolioSnapshotV2('profile-a', [snapshot], 20);
    saveUnifiedPortfolioSnapshotV2(unified, database);

    expect(listProfileConnectionsV2('profile-a', database)).toEqual([connection]);
    expect(getLatestUnifiedPortfolioSnapshotV2('profile-a', true, database)).toMatchObject({
      totalValueUsd: '50000', exposures: [{ exposureKey: 'BTC', quantity: '1' }],
    });
    expect(listPortfolioValuationObservations('profile-a', database)).toEqual([{
      observedAtMs: 20, totalValueUsd: '50000', unifiedSnapshotId: unified.id,
    }]);
    expect(() => database.prepare('DELETE FROM unified_portfolio_snapshots_v2').run()).toThrow();
  });

  it('supports repeated Coinbase identities and enforces profile-scoped reads', () => {
    const database = openDatabase(':memory:');
    const first = legacyCoinbaseConnection('profile-a', sha256Hex('key-a'), 10);
    const second = legacyCoinbaseConnection('profile-a', sha256Hex('key-b'), 11);
    saveProfileConnection(first, database);
    saveProfileConnection(second, database);
    saveProfileConnection({ ...first, label: 'Primary', status: 'attention_required', updatedAtMs: 12 }, database);

    expect(listProfileConnections('profile-a', database)).toHaveLength(2);
    expect(getProfileConnection('profile-a', first.id, database)).toMatchObject({
      label: 'Primary', status: 'attention_required', externalIdentityHash: sha256Hex('key-a'),
    });
    expect(getProfileConnection('profile-b', first.id, database)).toBeNull();
    expect(() => saveProfileConnection({ ...first, profileId: 'profile-b', updatedAtMs: 13 }, database))
      .toThrow();
    expect(ensureLegacyCoinbaseConnection('profile-a', sha256Hex('key-a'), 99, database))
      .toEqual(expect.objectContaining({ id: first.id, createdAtMs: 10 }));
  });

  it('persists immutable snapshots and aggregates duplicate assets with attribution', () => {
    const database = openDatabase(':memory:');
    const first = legacyCoinbaseConnection('profile-a', sha256Hex('key-a'), 10);
    const second = legacyCoinbaseConnection('profile-a', sha256Hex('key-b'), 10);
    saveProfileConnection(first, database);
    saveProfileConnection(second, database);
    const prices = (currency: string) => currency === 'BTC'
      ? { productId: 'BTC-USD', priceUsd: '50000' } : null;
    const firstSnapshot = coinbaseConnectionAccountSnapshot(
      first, [account('BTC', '1'), account('USD', '100')], ['order-b'], sha256Hex('rules-a'), 20, prices,
    );
    const secondSnapshot = coinbaseConnectionAccountSnapshot(
      second, [account('BTC', '0.5')], ['order-a'], sha256Hex('rules-b'), 21, prices,
    );
    saveConnectionAccountSnapshot(firstSnapshot, database);
    saveConnectionAccountSnapshot(firstSnapshot, database);
    saveConnectionAccountSnapshot(secondSnapshot, database);
    expect(getConnectionAccountSnapshot(firstSnapshot.id, database)).toEqual(firstSnapshot);

    const unified = buildUnifiedPortfolioSnapshot('profile-a', [secondSnapshot, firstSnapshot], 22);
    expect(unified).toMatchObject({ complete: true, totalValueUsd: '75100' });
    expect(unified.exposures.find((item) => item.exposureKey === 'BTC')).toMatchObject({
      quantity: '1.5', valueUsd: '75000', contributions: [{ connectionId: first.id }, { connectionId: second.id }],
    });
    saveUnifiedPortfolioSnapshot(unified, database);
    saveUnifiedPortfolioSnapshot(unified, database);
    expect(getUnifiedPortfolioSnapshot(unified.id, database)).toEqual(unified);
    expect(() => database.prepare('DELETE FROM connection_account_snapshots_v1').run()).toThrow();
  });

  it('keeps missing valuation explicit and rejects cross-profile aggregation', () => {
    const connection = legacyCoinbaseConnection('profile-a', sha256Hex('key'), 10);
    const partial = coinbaseConnectionAccountSnapshot(
      connection, [account('DOGE', '5')], [], sha256Hex('rules'), 20, () => null,
    );
    const unified = buildUnifiedPortfolioSnapshot('profile-a', [partial], 21);
    expect(unified).toMatchObject({ complete: false, totalValueUsd: null });
    expect(unified.exposures[0]).toMatchObject({ exposureKey: 'DOGE', valueUsd: null });
    expect(() => buildUnifiedPortfolioSnapshot('profile-b', [partial], 21)).toThrow();
  });

  it('acquires Coinbase through the provider-neutral port with scoped credentials', async () => {
    const connection = legacyCoinbaseConnection('profile-a', sha256Hex('key'), 10);
    const secretRef = {
      profileId: 'profile-a', connectionId: connection.id, provider: 'coinbase',
      credentialType: 'api_credentials',
    } as const;
    const secretStore = createMemorySecretStore();
    await writeConnectionSecret(secretStore, secretRef, serializeCoinbaseCredentials({
      keyName: 'organizations/example/apiKeys/key-id',
      privateKey: Buffer.alloc(32, 7).toString('base64'),
    }));
    const provider = createCoinbaseAccountSnapshotProvider({
      secretStore,
      acquirer: { async acquire() {
        return { accounts: [account('BTC', '2')], pendingOrderIds: [], rulesHash: sha256Hex('rules') };
      } },
      resolvePrice: () => ({ productId: 'BTC-USD', priceUsd: '50000' }),
      nowMs: () => 25,
    });
    await expect(provider.acquire(connection, secretRef)).resolves.toMatchObject({
      profileId: 'profile-a', connectionId: connection.id, complete: true,
      balances: [{ valueUsd: '100000' }],
    });
    await expect(provider.acquire(connection, { ...secretRef, profileId: 'profile-b' }))
      .rejects.toThrow('ownership');

    const database = openDatabase(':memory:');
    saveProfileConnection(connection, database);
    const service = new ConnectionPortfolioSnapshotService({
      database, providers: [provider], nowMs: () => 25,
    });
    await expect(service.refresh('profile-a')).resolves.toMatchObject({
      profileId: 'profile-a', complete: true, totalValueUsd: '100000',
    });
  });
});
