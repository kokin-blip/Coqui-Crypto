import { describe, expect, it, vi } from 'vitest';

import { createConnectionHandlers } from '../apps/desktop/src/main/connection-handlers.js';
import { createMemorySecretStore, type RobinhoodCryptoReadClient } from '../packages/adapters/src/index.js';
import { FixedClock, instrumentKey, sha256Hex } from '../packages/core/src/index.js';
import { getLatestUnifiedPortfolioSnapshotV2, legacyCoinbaseConnection, listProfileConnectionsV2,
  openDatabase, saveProfileConnection } from '../packages/storage/src/index.js';

const PRIVATE_KEY = 'xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=';
const API_KEY = 'rh-api-6148effc-c0b1-486c-8940-a1d099456be6';

function robinhoodClient(): RobinhoodCryptoReadClient {
  const unsupported = vi.fn(async () => ({ ok: true as const, value: [] }));
  return {
    accounts: unsupported, holdings: unsupported, openOrders: unsupported,
    tradingPairs: unsupported, bestBidAsk: unsupported, estimatedPrice: unsupported,
    acquire: vi.fn(async () => ({ ok: true as const, value: {
      accounts: [{ accountNumber: 'RHS-ACCOUNT-1234', status: 'active', buyingPower: '200',
        buyingPowerCurrency: 'USD', apiTradable: true, feeRatio: '0.0025' }],
      holdings: [{ accountNumber: 'RHS-ACCOUNT-1234', assetCode: 'BTC',
        totalQuantity: '0.25', availableQuantity: '0.2' }],
      openOrders: [{ id: 'pending-1', accountNumber: 'RHS-ACCOUNT-1234', state: 'pending', symbol: 'BTC-USD' }],
      tradingPairs: [{ symbol: 'BTC-USD', assetCode: 'BTC', quoteCode: 'USD' as const,
        assetIncrement: '0.00000001', quoteIncrement: '0.01', maxOrderSize: '100',
        minOrderAmount: '1', status: 'tradable', apiTradable: true }],
      bestPrices: [{ symbol: 'BTC-USD', bid: '49900', ask: '50100' }],
    } })),
    destroy: vi.fn(),
  };
}

describe('provider-neutral connection handlers', () => {
  it('materializes v1 Coinbase connection rows into the v2 compatibility view', async () => {
    const database = openDatabase(':memory:');
    const legacy = { ...legacyCoinbaseConnection('main', sha256Hex('legacy-key'), 10),
      label: 'Imported Coinbase', status: 'attention_required' as const, updatedAtMs: 12 };
    saveProfileConnection(legacy, database);
    const handlers = createConnectionHandlers({ profileId: 'main', database,
      clock: new FixedClock(20), priceSource: { name: 'fixture', async spot() { return new Map(); } } });
    const list = handlers['connections.list'] as unknown as () => Promise<{
      ok: true; value: { connections: readonly { label: string; status: string }[] };
    }>;
    await expect(list()).resolves.toMatchObject({ ok: true, value: { connections: [{
      label: 'Imported Coinbase', status: 'attention_required',
    }] } });
    expect(listProfileConnectionsV2('main', database)).toHaveLength(1);
    expect(database.prepare('SELECT v1_connection_id FROM profile_connection_migration_links_v1').get())
      .toEqual({ v1_connection_id: legacy.id });
    database.close();
  });

  it('imports Robinhood in main, verifies read-only access, and persists an attributed portfolio', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore();
    const handlers = createConnectionHandlers({ profileId: 'main', database,
      clock: new FixedClock(1_800_000_000_000), secrets,
      pickConnectionFile: async () => ({ contents: JSON.stringify({ apiKey: API_KEY, privateKeyBase64: PRIVATE_KEY }) }),
      robinhoodClientFactory: () => robinhoodClient(),
      priceSource: { name: 'fixture', async spot(instruments) {
        return new Map(instruments.map((instrument) => [instrumentKey(instrument), {
          priceUsd: '50000' as never, source: 'fixture', quality: 'venue_reported_last' as const,
          observedAtMs: 1_799_999_999_000,
        }]));
      } },
    });
    const connect = handlers['connections.connect-file'] as unknown as (payload: {
      commandId: string; provider: 'robinhood_crypto';
    }) => Promise<{ ok: boolean; value?: unknown }>;
    const result = await connect({
      commandId: '00000000-0000-4000-8000-000000000001', provider: 'robinhood_crypto',
    });
    expect(result).toMatchObject({ ok: true, value: { provider: 'robinhood_crypto',
      accountSuffixes: ['1234'], liveExecutionAuthority: false } });
    expect(getLatestUnifiedPortfolioSnapshotV2('main', true, database)).toMatchObject({
      totalValueUsd: '12700', exposures: [
        { exposureKey: 'BTC', quantity: '0.25', contributions: [{ provider: 'robinhood_crypto' }] },
        { exposureKey: 'USD', quantity: '200' },
      ],
    });
    const stored = JSON.stringify(database.prepare("SELECT * FROM profile_connections_v2").all());
    expect(stored).not.toContain(API_KEY);
    expect(stored).not.toContain(PRIVATE_KEY);
    database.close();
  });

  it('keeps a generated Robinhood private key out of IPC and completes from an explicit clipboard read', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore();
    const handlers = createConnectionHandlers({ profileId: 'main', database,
      clock: new FixedClock(1_800_000_000_000), secrets, readClipboardText: () => API_KEY,
      robinhoodClientFactory: () => robinhoodClient(),
      priceSource: { name: 'fixture', async spot(instruments) { return new Map(instruments.map((instrument) => [instrumentKey(instrument), {
        priceUsd: '50000' as never, source: 'fixture', quality: 'venue_reported_last' as const,
        observedAtMs: 1_799_999_999_000,
      }])); } },
    });
    const begin = handlers['connections.robinhood.keypair.begin'] as unknown as (payload: { commandId: string }) => Promise<{ ok: true; value: { setupId: string; publicKeyBase64: string; privateKeyLocation: string } }>;
    const started = await begin({ commandId: '00000000-0000-4000-8000-000000000002' });
    expect(started.value).toMatchObject({ privateKeyLocation: 'os_keychain' });
    expect(JSON.stringify(started)).not.toContain(PRIVATE_KEY);
    expect(started.value.publicKeyBase64).toHaveLength(44);
    const complete = handlers['connections.robinhood.keypair.complete'] as unknown as (payload: { commandId: string; setupId: string }) => Promise<{ ok: boolean; value?: { provider: string } }>;
    await expect(complete({ commandId: '00000000-0000-4000-8000-000000000003', setupId: started.value.setupId }))
      .resolves.toMatchObject({ ok: true, value: { provider: 'robinhood_crypto' } });
    await expect(secrets.read('robinhood-pending-private-key', `pending.main.${started.value.setupId}`))
      .resolves.toEqual({ ok: true, value: null });
    expect(database.prepare('SELECT status FROM robinhood_connection_setups_v1 WHERE id=?').get(started.value.setupId))
      .toEqual({ status: 'completed' });
    database.close();
  });

  it('restores an unexpired Robinhood setup after the host is reconstructed', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore();
    const shared = { profileId: 'main', database, clock: new FixedClock(1_800_000_000_000), secrets,
      readClipboardText: () => API_KEY, robinhoodClientFactory: () => robinhoodClient(),
      priceSource: { name: 'fixture', async spot(instruments: readonly Parameters<typeof instrumentKey>[0][]) {
        return new Map(instruments.map((instrument) => [instrumentKey(instrument), {
          priceUsd: '50000' as never, source: 'fixture', quality: 'venue_reported_last' as const,
          observedAtMs: 1_799_999_999_000,
        }]));
      } },
    };
    const firstHost = createConnectionHandlers(shared);
    const begin = firstHost['connections.robinhood.keypair.begin'] as unknown as
      (payload: { commandId: string }) => Promise<{ ok: true; value: { setupId: string; publicKeyBase64: string } }>;
    const started = await begin({ commandId: '00000000-0000-4000-8000-000000000004' });

    const restartedHost = createConnectionHandlers(shared);
    const resume = restartedHost['connections.robinhood.keypair.begin'] as unknown as
      (payload: { commandId: string }) => Promise<{ ok: true; value: { setupId: string } }>;
    await expect(resume({ commandId: '00000000-0000-4000-8000-000000000007' }))
      .resolves.toMatchObject({ ok: true, value: { setupId: started.value.setupId } });
    const status = restartedHost['connections.robinhood.keypair.status'] as unknown as () => Promise<unknown>;
    const restored = await status();
    expect(restored).toMatchObject({ ok: true, value: { state: 'pending', setup: {
      setupId: started.value.setupId, publicKeyBase64: started.value.publicKeyBase64,
      privateKeyLocation: 'os_keychain',
    }, reasonCode: null } });
    expect(JSON.stringify(restored)).not.toContain('privateKeyBase64');

    const complete = restartedHost['connections.robinhood.keypair.complete'] as unknown as
      (payload: { commandId: string; setupId: string }) => Promise<unknown>;
    await expect(complete({ commandId: '00000000-0000-4000-8000-000000000005',
      setupId: started.value.setupId })).resolves.toMatchObject({ ok: true,
      value: { provider: 'robinhood_crypto' } });
    database.close();
  });

  it('does not restore a pending setup across profiles', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore();
    const setup = createConnectionHandlers({ profileId: 'main', database,
      clock: new FixedClock(1_800_000_000_000), secrets,
      priceSource: { name: 'fixture', async spot() { return new Map(); } } });
    const begin = setup['connections.robinhood.keypair.begin'] as unknown as
      (payload: { commandId: string }) => Promise<unknown>;
    await begin({ commandId: '00000000-0000-4000-8000-000000000006' });
    const otherProfile = createConnectionHandlers({ profileId: 'other', database,
      clock: new FixedClock(1_800_000_000_000), secrets,
      priceSource: { name: 'fixture', async spot() { return new Map(); } } });
    const status = otherProfile['connections.robinhood.keypair.status'] as unknown as () => Promise<unknown>;
    await expect(status()).resolves.toEqual({ ok: true,
      value: { state: 'none', setup: null, reasonCode: null } });
    database.close();
  });

  it('reports an unavailable restored setup when its keychain entry is missing', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore();
    const input = { profileId: 'main', database, clock: new FixedClock(1_800_000_000_000), secrets,
      priceSource: { name: 'fixture', async spot() { return new Map(); } } };
    const handlers = createConnectionHandlers(input);
    const begin = handlers['connections.robinhood.keypair.begin'] as unknown as
      (payload: { commandId: string }) => Promise<{ ok: true; value: { setupId: string } }>;
    const started = await begin({ commandId: '00000000-0000-4000-8000-000000000008' });
    await secrets.remove('robinhood-pending-private-key', `pending.main.${started.value.setupId}`);
    const restarted = createConnectionHandlers(input);
    const status = restarted['connections.robinhood.keypair.status'] as unknown as () => Promise<unknown>;
    await expect(status()).resolves.toMatchObject({ ok: true, value: { state: 'unavailable',
      setup: { setupId: started.value.setupId }, reasonCode: 'pending_key_unavailable' } });
    database.close();
  });
});
