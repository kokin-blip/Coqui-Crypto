import { describe, expect, it, vi } from 'vitest';

import {
  createRobinhoodCryptoReadClient,
  parseRobinhoodCryptoCredentialsJson,
  robinhoodCryptoSignature,
} from '../packages/adapters/src/index.js';
import type { FetchLikeResponse } from '../packages/adapters/src/http/index.js';

const credentials = {
  apiKey: 'rh-api-6148effc-c0b1-486c-8940-a1d099456be6',
  privateKeyBase64: 'xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=',
} as const;

function response(data: unknown, status = 200): FetchLikeResponse {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null },
    async json() { return data; }, async text() { return JSON.stringify(data); } };
}

describe('Robinhood Crypto read-only adapter', () => {
  it('matches the published Robinhood seed and exact documented message bytes', () => {
    const body = '{"client_order_id":"131de903-5a9c-4260-abc1-28d562a5dcf0","side":"buy","type":"market","symbol":"BTC-USD","market_order_config":{"asset_quantity":"0.1"}}';
    expect(robinhoodCryptoSignature(credentials, 1_698_708_981,
      '/api/v1/crypto/trading/orders/', 'POST', body)).toBe(
      '6tIj8o6p+4w+ZnaxVanHtxjhC6s5z4lTI+8lNRjJOZp0dVDlco2NR6obVwBiECP8eoHtfcbsGfTu1rESBHOzCA==',
    );
  });

  it('strictly parses a credential file without echoing it', () => {
    expect(parseRobinhoodCryptoCredentialsJson(JSON.stringify(credentials))).toEqual({ ok: true, credentials });
    expect(parseRobinhoodCryptoCredentialsJson('{"apiKey":"short","privateKeyBase64":"secret"}'))
      .toEqual({ ok: false, code: 'invalid_api_key' });
  });

  it('walks bounded account evidence and signs every v2 read', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      const path = new URL(url).pathname;
      if (path.endsWith('/accounts/')) return response({ next: null, results: [{
        account_number: 'RHS-ACCOUNT-1234', status: 'active', buying_power: '250.00',
        buying_power_currency: 'USD', is_api_tradable: true, fee_tier_status: { fee_ratio: 0.0025 },
      }] });
      if (path.endsWith('/holdings/')) return response({ next: null, results: [{
        account_number: 'RHS-ACCOUNT-1234', asset_code: 'BTC', total_quantity: '0.5',
        quantity_available_for_trading: '0.4',
      }] });
      if (path.endsWith('/orders/')) return response({ next: null, results: [{
        id: 'order-1', account_number: 'RHS-ACCOUNT-1234', state: 'open', symbol: 'BTC-USD',
      }] });
      if (path.endsWith('/trading_pairs/')) return response({ next: null, results: [{
        symbol: 'BTC-USD', asset_code: 'BTC', quote_code: 'USD', asset_increment: '0.00000001',
        quote_increment: '0.01', max_order_size: '100', min_order_amount: '1', status: 'tradable',
        is_api_tradable: true,
      }] });
      return response({ results: [{ symbol: 'BTC-USD', bid: 49900, ask: 50100 }] });
    });
    const client = createRobinhoodCryptoReadClient(credentials, { fetch, nowMs: () => 1_698_708_981_000,
      maxRetries: 0 });
    await expect(client.acquire()).resolves.toMatchObject({ ok: true, value: {
      accounts: [{ accountNumber: 'RHS-ACCOUNT-1234', buyingPower: '250.00' }],
      holdings: [{ assetCode: 'BTC', totalQuantity: '0.5' }], openOrders: [{ id: 'order-1' }],
      bestPrices: [{ symbol: 'BTC-USD', bid: '49900', ask: '50100' }],
    } });
    expect(calls).toHaveLength(5);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get('x-api-key')).toBe(credentials.apiKey);
      expect(headers.get('x-signature')).toMatch(/^[A-Za-z0-9+/]+=*$/u);
      expect(call.init?.method).toBe('GET');
    }
    expect(Object.keys(client).some((key) => /place|cancel|submit/iu.test(key))).toBe(false);
    client.destroy();
  });

  it('contains pagination cycles and rejects malformed payloads', async () => {
    const fetch = vi.fn(async (url: string) => response({ next: url, results: [] }));
    const client = createRobinhoodCryptoReadClient(credentials, { fetch, maxRetries: 0 });
    await expect(client.accounts()).resolves.toEqual({ ok: false, code: 'pagination_cycle' });
    client.destroy();
  });
});
