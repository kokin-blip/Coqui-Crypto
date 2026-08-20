import {
  instrumentKey,
  type InstrumentIdentity,
} from '../packages/core/src/index.js';
import {
  createCoinbaseAssetCatalog,
  createCoinbasePriceSource,
  fetchCoinbaseDailyBars,
  type HttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';
import { describe, expect, it } from 'vitest';

const DAY_MS = 86_400_000;
const BTC: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'BTC-USD',
  productType: 'spot',
};
const ETH: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'ETH-USD',
  productType: 'spot',
};

type JsonHandler = <T>(url: string) => Promise<HttpResult<T>>;

function httpClient(getJson: JsonHandler): HttpClient {
  const unavailable = async <T>(): Promise<HttpResult<T>> => ({
    ok: false,
    status: 501,
    reason: 'http',
    retried: 0,
  });
  return {
    getJson,
    postJson: unavailable,
    getText: unavailable,
    destroy: () => {},
  };
}

function httpByUrl(routes: ReadonlyArray<{ match: string; payload: unknown }>): HttpClient {
  return httpClient(async <T>(url: string) => {
    const route = routes.find(({ match }) => url.includes(match));
    return route
      ? { ok: true, status: 200, data: route.payload as T }
      : { ok: false, status: 404, reason: 'http', retried: 0 };
  });
}

describe('createCoinbasePriceSource', () => {
  it('keys exact decimal spot prices by canonical instrument identity', async () => {
    const source = createCoinbasePriceSource(httpByUrl([
      { match: '/BTC-USD/stats', payload: { last: '65000.50000000' } },
      { match: '/ETH-USD/stats', payload: null },
    ]));

    const prices = await source.spot([BTC, ETH]);

    expect([...prices.entries()]).toEqual([
      [instrumentKey(BTC), {
        priceUsd: '65000.50000000',
        source: 'coinbase',
        quality: 'venue_reported_last',
        observedAtMs: null,
      }],
    ]);
    expect(Object.isFrozen(prices.get(instrumentKey(BTC)))).toBe(true);
  });

  it('normalizes valid candles oldest-first and rejects unknown timeframes', async () => {
    let calls = 0;
    const getJson: JsonHandler = async <T>(): Promise<HttpResult<T>> => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        data: [
          [200, 9, 12, 10, 11, 5],
          [100, 8, 11, 9, 10, 4],
          [50, 9, 8, 9, 9, 1],
        ] as T,
      };
    };
    const source = createCoinbasePriceSource(httpClient(getJson));

    const candles = await source.candles!(BTC, '1h');

    expect(candles).toEqual([
      { time: 100_000, open: 9, high: 11, low: 8, close: 10, volume: 4 },
      { time: 200_000, open: 10, high: 12, low: 9, close: 11, volume: 5 },
    ]);
    await expect(source.candles!(BTC, '2h')).resolves.toEqual([]);
    expect(calls).toBe(1);
  });
});

describe('fetchCoinbaseDailyBars', () => {
  it('pages beyond 300 candles and returns provenanced bars oldest-first', async () => {
    const nowMs = Date.UTC(2025, 0, 1);
    const genesisMs = nowMs - 700 * DAY_MS;
    const http = httpClient(async <T>(url: string): Promise<HttpResult<T>> => {
      const parsed = new URL(url);
      const startMs = Date.parse(parsed.searchParams.get('start')!);
      const endMs = Date.parse(parsed.searchParams.get('end')!);
      const rows: number[][] = [];
      for (let timeMs = endMs - DAY_MS; timeMs >= Math.max(startMs, genesisMs); timeMs -= DAY_MS) {
        const close = 100 + (timeMs - genesisMs) / DAY_MS;
        rows.push([timeMs / 1_000, close - 2, close + 2, close - 1, close, 10]);
      }
      return { ok: true, status: 200, data: rows as T };
    });

    const result = await fetchCoinbaseDailyBars(http, BTC, {
      maxDays: 620,
      nowMs,
      retrievedAtMs: nowMs + 1_000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(620);
    expect(result.data[0]?.startTimeMs).toBe(nowMs - 620 * DAY_MS);
    expect(result.data.at(-1)).toMatchObject({
      assetId: instrumentKey(BTC),
      source: 'coinbase',
      interval: '1d',
      quality: 'reported_ohlc',
      isComplete: false,
      retrievedAtMs: nowMs + 1_000,
    });
    expect(result.data.at(-2)?.isComplete).toBe(true);
  });

  it('marks the current daily interval incomplete', async () => {
    const startMs = Date.UTC(2025, 0, 1);
    const nowMs = startMs + DAY_MS + 60_000;
    const http = httpByUrl([{
      match: '/candles?',
      payload: [[startMs / 1_000, 9, 12, 10, 11, 5]],
    }]);

    const result = await fetchCoinbaseDailyBars(http, BTC, { maxDays: 2, nowMs });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0]?.isComplete).toBe(false);
  });

  it('rejects a malformed page instead of returning partial data', async () => {
    const nowMs = Date.UTC(2025, 0, 2);
    const result = await fetchCoinbaseDailyBars(
      httpByUrl([{ match: '/candles?', payload: [[1, 'bad']] }]),
      BTC,
      { maxDays: 2, nowMs },
    );

    expect(result).toEqual({ ok: false, status: 200, reason: 'parse', retried: 0 });
  });

  it('preserves transport failures without exposing their body', async () => {
    const result = await fetchCoinbaseDailyBars(
      httpClient(async () => ({
        ok: false,
        status: 429,
        reason: 'http',
        retried: 3,
        traceId: 'coinbase-trace',
      })),
      BTC,
      { maxDays: 2, nowMs: Date.UTC(2025, 0, 2) },
    );

    expect(result).toEqual({
      ok: false,
      status: 429,
      reason: 'http',
      retried: 3,
      traceId: 'coinbase-trace',
    });
  });
});

describe('createCoinbaseAssetCatalog', () => {
  const products = [
    null,
    { id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD', status: 'online' },
    { id: 'BTC-USD-ALT', base_currency: 'BTC', quote_currency: 'USD', status: 'online' },
    { id: 'ETH-USD', base_currency: 'ETH', quote_currency: 'USD', status: 'online' },
    { id: 'OLD-USD', base_currency: 'OLD', quote_currency: 'USD', status: 'delisted' },
    { id: 'BTC-EUR', base_currency: 'BTC', quote_currency: 'EUR', status: 'online' },
  ];
  const currencies = [
    null,
    { id: 'BTC', name: 'Bitcoin' },
    { id: 'ETH', name: 'Ethereum' },
  ];

  it('filters products and preserves distinct canonical identities', async () => {
    const catalog = createCoinbaseAssetCatalog(httpByUrl([
      { match: '/products', payload: products },
      { match: '/currencies', payload: currencies },
    ]));

    const assets = await catalog.page(0, 20);

    expect(assets.map(({ instrument }) => instrument.productId)).toEqual([
      'BTC-USD',
      'BTC-USD-ALT',
      'ETH-USD',
    ]);
    expect(assets[0]).toMatchObject({
      symbol: 'BTC',
      name: 'Bitcoin',
      baseAsset: 'BTC',
      quoteAsset: 'USD',
      coingeckoId: null,
      instrument: BTC,
    });
  });

  it('ranks search and retries catalog construction after a transient outage', async () => {
    let available = false;
    const http = httpClient(async <T>(url: string): Promise<HttpResult<T>> => {
      if (!available) return { ok: false, status: 503, reason: 'http', retried: 3 };
      const data = url.endsWith('/products') ? products : currencies;
      return { ok: true, status: 200, data: data as T };
    });
    const catalog = createCoinbaseAssetCatalog(http);

    await expect(catalog.page(0, 20)).resolves.toEqual([]);
    available = true;
    const results = await catalog.search('eth');
    expect(results.map(({ symbol }) => symbol)).toEqual(['ETH']);
  });
});
