import {
  instrumentKey,
  type AssetRef,
  type InstrumentIdentity,
} from '../packages/core/src/index.js';
import {
  createCoinGeckoPriceSource,
  fetchCoinGeckoMarketSnapshots,
  withPriceFallback,
  type HttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';
import { describe, expect, it, vi } from 'vitest';

type AdapterPriceSource = Parameters<typeof withPriceFallback>[0];
type AdapterUsd = Awaited<ReturnType<AdapterPriceSource['spot']>> extends
  ReadonlyMap<string, infer Value> ? Value : never;

function adapterUsd(value: string): AdapterUsd {
  return value as AdapterUsd;
}

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
const SOL: InstrumentIdentity = {
  venue: 'coinbase',
  productId: 'SOL-USD',
  productType: 'spot',
};

function asset(
  instrument: InstrumentIdentity,
  coingeckoId: string | null,
): AssetRef {
  const symbol = instrument.productId.split('-')[0]!;
  return {
    instrument,
    symbol,
    name: symbol,
    baseAsset: symbol,
    quoteAsset: 'USD',
    coingeckoId,
  };
}

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

function successfulHttp(payload: unknown, urls: string[] = []): HttpClient {
  return httpClient(async <T>(url: string) => {
    urls.push(url);
    return { ok: true, status: 200, data: payload as T };
  });
}

describe('createCoinGeckoPriceSource', () => {
  it('uses explicit CoinGecko IDs and returns canonical instrument keys', async () => {
    const urls: string[] = [];
    const source = createCoinGeckoPriceSource(
      successfulHttp({
        bitcoin: { usd: 65_000.25 },
        ethereum: { usd: 3_500 },
      }, urls),
      [asset(BTC, 'bitcoin'), asset(ETH, 'ethereum')],
    );

    const prices = await source.spot([BTC, ETH]);

    expect([...prices.entries()]).toEqual([
      [instrumentKey(BTC), '65000.25'],
      [instrumentKey(ETH), '3500'],
    ]);
    const request = new URL(urls[0]!);
    expect(request.pathname).toBe('/api/v3/simple/price');
    expect(request.searchParams.get('ids')).toBe('bitcoin,ethereum');
    expect(request.searchParams.get('vs_currencies')).toBe('usd');
    expect(request.searchParams.get('precision')).toBe('full');
  });

  it('does not request unmapped instruments or join by display symbol', async () => {
    let called = false;
    const getJson: JsonHandler = async <T>(): Promise<HttpResult<T>> => {
      called = true;
      return { ok: true, status: 200, data: {} as T };
    };
    const source = createCoinGeckoPriceSource(
      httpClient(getJson),
      [asset(BTC, null), { ...asset(ETH, null), symbol: 'BTC' }],
    );

    await expect(source.spot([BTC, ETH])).resolves.toEqual(new Map());
    expect(called).toBe(false);
  });

  it('rejects zero, negative, non-finite, and malformed provider prices', async () => {
    const source = createCoinGeckoPriceSource(
      successfulHttp({
        bitcoin: { usd: 0 },
        ethereum: { usd: -1 },
        solana: { usd: '150' },
      }),
      [asset(BTC, 'bitcoin'), asset(ETH, 'ethereum'), asset(SOL, 'solana')],
    );

    await expect(source.spot([BTC, ETH, SOL])).resolves.toEqual(new Map());
  });

  it('expands exponent notation into a ledger-safe decimal string', async () => {
    const source = createCoinGeckoPriceSource(
      successfulHttp({ bitcoin: { usd: 6.5e-7 } }),
      [asset(BTC, 'bitcoin')],
    );

    expect([...await source.spot([BTC])]).toEqual([
      [instrumentKey(BTC), '0.00000065'],
    ]);
  });

  it('degrades failed or malformed batches without throwing', async () => {
    const failed = createCoinGeckoPriceSource(
      httpClient(async <T>() => ({
        ok: false,
        status: 429,
        reason: 'http',
        retried: 3,
      }) as HttpResult<T>),
      [asset(BTC, 'bitcoin')],
    );
    const malformed = createCoinGeckoPriceSource(
      successfulHttp([]),
      [asset(BTC, 'bitcoin')],
    );

    await expect(failed.spot([BTC])).resolves.toEqual(new Map());
    await expect(malformed.spot([BTC])).resolves.toEqual(new Map());
  });

  it('fans one explicitly mapped provider ID out to each canonical product', async () => {
    const wrappedBtc: InstrumentIdentity = {
      venue: 'coinbase',
      productId: 'WBTC-USD',
      productType: 'spot',
    };
    const source = createCoinGeckoPriceSource(
      successfulHttp({ bitcoin: { usd: 65_000 } }),
      [asset(BTC, 'bitcoin'), asset(wrappedBtc, 'bitcoin')],
    );

    const prices = await source.spot([BTC, wrappedBtc]);
    expect(prices.get(instrumentKey(BTC))).toBe('65000');
    expect(prices.get(instrumentKey(wrappedBtc))).toBe('65000');
  });
});

describe('withPriceFallback', () => {
  it('queries the fallback only for missing canonical instruments', async () => {
    const fallbackSpot = vi.fn(async () => new Map([
      [instrumentKey(ETH), adapterUsd('3500')],
    ]));
    const primary: AdapterPriceSource = {
      name: 'primary',
      spot: async () => new Map([
        [instrumentKey(BTC), adapterUsd('65000')],
      ]),
    };
    const fallback: AdapterPriceSource = { name: 'fallback', spot: fallbackSpot };

    const prices = await withPriceFallback(primary, fallback).spot([BTC, ETH]);

    expect(fallbackSpot).toHaveBeenCalledWith([ETH]);
    expect([...prices.entries()]).toEqual([
      [instrumentKey(ETH), '3500'],
      [instrumentKey(BTC), '65000'],
    ]);
  });

  it('keeps primary prices when a fallback returns the same key', async () => {
    const primary: AdapterPriceSource = {
      name: 'primary',
      spot: async () => new Map([
        [instrumentKey(BTC), adapterUsd('65000')],
      ]),
    };
    const fallback: AdapterPriceSource = {
      name: 'fallback',
      spot: async () => new Map([
        [instrumentKey(BTC), adapterUsd('1')],
        [instrumentKey(ETH), adapterUsd('3500')],
      ]),
    };

    const prices = await withPriceFallback(primary, fallback).spot([BTC, ETH]);
    expect([...prices].find(([key]) => key === instrumentKey(BTC))?.[1]).toBe('65000');
  });
});

describe('fetchCoinGeckoMarketSnapshots', () => {
  it('maps price and market metadata through explicit canonical IDs', async () => {
    const snapshots = await fetchCoinGeckoMarketSnapshots(
      successfulHttp([{
        id: 'bitcoin',
        symbol: 'not-used-for-joining',
        current_price: 65_000,
        market_cap: 1_300_000_000_000,
        market_cap_rank: 1,
        total_volume: 20_000_000_000,
        price_change_percentage_24h: 2.5,
        price_change_percentage_7d_in_currency: -3.1,
        image: 'https://example.test/bitcoin.png',
        last_updated: '2026-08-01T12:30:00.000Z',
      }]),
      [asset(BTC, 'bitcoin')],
    );

    expect([...snapshots.entries()]).toEqual([[
      instrumentKey(BTC),
      {
        instrument: BTC,
        coingeckoId: 'bitcoin',
        priceUsd: '65000',
        marketCapUsd: '1300000000000',
        volume24hUsd: '20000000000',
        marketCapRank: 1,
        change24hPct: 2.5,
        change7dPct: -3.1,
        imageUrl: 'https://example.test/bitcoin.png',
        providerUpdatedAtMs: Date.parse('2026-08-01T12:30:00.000Z'),
      },
    ]]);
  });

  it('omits unrequested IDs and rows without a positive price', async () => {
    const snapshots = await fetchCoinGeckoMarketSnapshots(
      successfulHttp([
        { id: 'bitcoin', current_price: null },
        { id: 'lookalike', symbol: 'BTC', current_price: 65_000 },
      ]),
      [asset(BTC, 'bitcoin')],
    );

    expect(snapshots.size).toBe(0);
  });

  it('does not call the provider without explicit CoinGecko mappings', async () => {
    let called = false;
    const getJson: JsonHandler = async <T>(): Promise<HttpResult<T>> => {
      called = true;
      return { ok: true, status: 200, data: {} as T };
    };
    const snapshots = await fetchCoinGeckoMarketSnapshots(
      httpClient(getJson),
      [asset(BTC, null)],
    );

    expect(snapshots.size).toBe(0);
    expect(called).toBe(false);
  });
});
