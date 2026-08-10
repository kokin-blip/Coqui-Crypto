import { describe, expect, it } from 'vitest';

import type { InstrumentIdentity } from '../packages/core/src/index.js';
import {
  fetchCoinGeckoDemoSnapshots,
  fetchCoinMarketCapSnapshots,
  fetchCoinPaprikaSnapshots,
  type HttpClient,
  type HttpResult,
  type ProviderAssetMapping,
  type ProviderBatchResult,
} from '../packages/adapters/src/index.js';

type ProviderKey = Extract<ProviderBatchResult, { ok: true }>['snapshots'] extends
  ReadonlyMap<infer Key, unknown> ? Key : never;
const BTC_KEY = 'coinbase|spot|BTC-USD' as ProviderKey;

const BTC: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'BTC-USD',
  productType: 'spot',
};

const mapping: ProviderAssetMapping = {
  instrument: BTC,
  coingeckoId: 'bitcoin',
  coinMarketCapId: 1,
  coinPaprikaId: 'btc-bitcoin',
};

function http(payload: unknown, urls: string[] = []): HttpClient {
  const unavailable = async <T>(): Promise<HttpResult<T>> => ({
    ok: false,
    status: 501,
    reason: 'http',
    retried: 0,
  });
  return {
    async getJson<T>(url: string) {
      urls.push(url);
      return { ok: true, status: 200, data: payload as T };
    },
    postJson: unavailable,
    getText: unavailable,
    destroy: () => {},
  };
}

describe('normalized reference providers', () => {
  it('normalizes CoinGecko Demo snapshots through explicit IDs', async () => {
    const result = await fetchCoinGeckoDemoSnapshots(http([{
      id: 'bitcoin',
      symbol: 'IGNORED',
      current_price: 65_000.5,
      market_cap: 1_300_000,
      total_volume: 25_000,
      market_cap_rank: 1,
      price_change_percentage_24h: 2.25,
      last_updated: '2026-08-02T00:00:00.000Z',
    }]), [mapping]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshots.get(BTC_KEY)).toMatchObject({
      provider: 'coingecko',
      providerId: 'bitcoin',
      priceUsd: '65000.5',
      marketCapUsd: '1300000',
      volume24hUsd: '25000',
    });
  });

  it('uses CMC V3 numeric IDs and the USD quote array', async () => {
    const urls: string[] = [];
    const result = await fetchCoinMarketCapSnapshots(http({
      data: [{
        id: 1,
        symbol: 'IGNORED',
        cmc_rank: 1,
        quote: [{
          symbol: 'USD',
          price: 65_010,
          market_cap: 1_301_000,
          volume_24h: 26_000,
          percent_change_24h: 2.1,
          last_updated: '2026-08-02T00:01:00.000Z',
        }],
      }],
    }, urls), [mapping]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshots.get(BTC_KEY)).toMatchObject({
      provider: 'coinmarketcap',
      providerId: '1',
      priceUsd: '65010',
    });
    const request = new URL(urls[0]!);
    expect(request.pathname).toBe('/v3/cryptocurrency/quotes/latest');
    expect(request.searchParams.get('id')).toBe('1');
    expect(request.searchParams.has('symbol')).toBe(false);
  });

  it('filters CoinPaprika all-tickers data by explicit IDs', async () => {
    const result = await fetchCoinPaprikaSnapshots(http([
      {
        id: 'btc-lookalike',
        symbol: 'BTC',
        rank: 999,
        quotes: { USD: { price: 1 } },
      },
      {
        id: 'btc-bitcoin',
        symbol: 'NOT-USED',
        rank: 1,
        last_updated: '2026-08-02T00:02:00.000Z',
        quotes: {
          USD: {
            price: 64_990,
            market_cap: 1_299_000,
            volume_24h: 24_000,
            percent_change_24h: 2,
          },
        },
      },
    ]), [mapping]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.snapshots.values()]).toHaveLength(1);
    expect(result.snapshots.get(BTC_KEY)).toMatchObject({
      provider: 'coinpaprika',
      providerId: 'btc-bitcoin',
      priceUsd: '64990',
    });
  });

  it('returns a typed failure for malformed provider envelopes', async () => {
    await expect(fetchCoinMarketCapSnapshots(http({ data: {} }), [mapping]))
      .resolves.toEqual({ ok: false, code: 'invalid_payload', status: 200 });
    await expect(fetchCoinPaprikaSnapshots(http({}), [mapping]))
      .resolves.toEqual({ ok: false, code: 'invalid_payload', status: 200 });
  });
});
