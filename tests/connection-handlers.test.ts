import { describe, expect, it, vi } from 'vitest';

import { createConnectionHandlers } from '../apps/desktop/src/main/connection-handlers.js';
import { createMemorySecretStore, type RobinhoodCryptoReadClient } from '../packages/adapters/src/index.js';
import { FixedClock, instrumentKey } from '../packages/core/src/index.js';
import { getLatestUnifiedPortfolioSnapshotV2, openDatabase } from '../packages/storage/src/index.js';

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
});
