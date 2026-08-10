import { describe, expect, it } from 'vitest';

import {
  COINGECKO_DEMO_ENV,
  COINMARKETCAP_ENV,
  createCoinGeckoDemoHttpClient,
  createCoinMarketCapHttpClient,
  providerApiKeyStatus,
  readProviderApiKeys,
  type FetchLikeResponse,
  type RateLimiterRegistry,
} from '../packages/adapters/src/index.js';

function unlimitedRegistry(): RateLimiterRegistry {
  return {
    forDomain: () => ({
      acquire: async () => {},
      available: () => 1,
      pending: () => 0,
      destroy: () => {},
    }),
    destroyAll: () => {},
  };
}

function jsonResponse(data: unknown): FetchLikeResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

describe('provider environment boundary', () => {
  it('returns secrets internally but exposes presence-only diagnostics', () => {
    const coinGecko = 'demo-sensitive-value';
    const coinMarketCap = 'cmc-sensitive-value';
    const keys = readProviderApiKeys({
      [COINGECKO_DEMO_ENV]: ` ${coinGecko} `,
      [COINMARKETCAP_ENV]: coinMarketCap,
    });

    expect(keys).toEqual({ coinGeckoDemo: coinGecko, coinMarketCap });
    const status = providerApiKeyStatus(keys);
    expect(status).toEqual({ coinGeckoDemo: true, coinMarketCap: true });
    expect(JSON.stringify(status)).not.toContain(coinGecko);
    expect(JSON.stringify(status)).not.toContain(coinMarketCap);
  });
});

describe('authenticated provider clients', () => {
  it('places the CoinGecko Demo key in a header and rejects redirects', async () => {
    const calls: RequestInit[] = [];
    const key = 'coin-gecko-secret';
    const client = createCoinGeckoDemoHttpClient(key, {
      maxRetries: 0,
      rateLimiters: unlimitedRegistry(),
      fetch: async (_url, init) => {
        calls.push(init ?? {});
        return jsonResponse({ gecko_says: '(V3) To the Moon!' });
      },
    });

    await expect(client.getJson('https://api.coingecko.com/api/v3/ping'))
      .resolves.toMatchObject({ ok: true, status: 200 });
    expect(new Headers(calls[0]?.headers).get('x-cg-demo-api-key')).toBe(key);
    expect(calls[0]?.redirect).toBe('error');
    client.destroy();
  });

  it('never sends a CMC key to a different host or exposes it in failure data', async () => {
    const key = 'cmc-never-print-this';
    let called = false;
    const client = createCoinMarketCapHttpClient(key, {
      maxRetries: 0,
      rateLimiters: unlimitedRegistry(),
      fetch: async () => {
        called = true;
        return jsonResponse({});
      },
    });

    const result = await client.getJson('https://example.test/v1/key/info');
    expect(result).toMatchObject({ ok: false, reason: 'network' });
    expect(called).toBe(false);
    expect(JSON.stringify(result)).not.toContain(key);
    client.destroy();
  });
});
