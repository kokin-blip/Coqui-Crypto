import { describe, expect, it } from 'vitest';

import {
  fetchCoinbaseUniverseProducts,
  type HttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';

function http(result: HttpResult<unknown>): HttpClient {
  const unavailable = async <T>(): Promise<HttpResult<T>> => ({
    ok: false, status: 501, reason: 'http', retried: 0,
  });
  return {
    getJson: async <T>() => result as HttpResult<T>,
    postJson: unavailable,
    getText: async () => ({ ok: false, status: 501, reason: 'http', retried: 0 }),
    destroy: () => {},
  };
}

const online = {
  id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online',
  trading_disabled: false, cancel_only: false, limit_only: false, post_only: false,
  base_increment: '0.00000001', quote_increment: '0.01', min_market_funds: '1',
};

describe('Coinbase universe adapter', () => {
  it('captures active and delisted USD products without symbol inference', async () => {
    const result = await fetchCoinbaseUniverseProducts(http({
      ok: true, status: 200, data: [
        online,
        { ...online, id: 'OLD-USD', base_currency: 'OLD', status: 'delisted' },
        { ...online, id: 'BTC-EUR', quote_currency: 'EUR' },
      ],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((product) => [product.instrument.productId, product.status]))
      .toEqual([['BTC-USD', 'online'], ['OLD-USD', 'delisted']]);
    expect(result.data[0]).toEqual(expect.objectContaining({
      baseIncrement: '0.00000001', quoteIncrement: '0.01', minMarketFunds: '1',
    }));
  });

  it('fails the entire observation when a USD product row is malformed', async () => {
    await expect(fetchCoinbaseUniverseProducts(http({
      ok: true, status: 200, data: [online, { ...online, cancel_only: 'false' }],
    }))).resolves.toEqual({ ok: false, status: 200, reason: 'parse', retried: 0 });
  });

  it('preserves secret-safe transport failures', async () => {
    await expect(fetchCoinbaseUniverseProducts(http({
      ok: false, status: 429, reason: 'http', retried: 3,
    }))).resolves.toEqual({ ok: false, status: 429, reason: 'http', retried: 3 });
  });
});
