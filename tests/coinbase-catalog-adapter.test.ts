import { describe, expect, it, vi } from 'vitest';

import {
  createCoinbaseCatalogSource,
  type HttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';

function success(data: unknown): HttpResult<unknown> {
  return { ok: true, status: 200, data };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'BTC-USD', base_currency: 'BTC', quote_currency: 'USD',
    status: 'online', trading_disabled: false, ...overrides,
  };
}

function httpByUrl(
  products: HttpResult<unknown>,
  currencies: HttpResult<unknown> = success([]),
): HttpClient {
  return {
    getJson: vi.fn(async (url: string) => url.endsWith('/currencies') ? currencies : products),
    postJson: vi.fn(), getText: vi.fn(), destroy: vi.fn(),
  } as unknown as HttpClient;
}

describe('Coinbase catalog acquisition', () => {
  it('returns only online Coinbase USD products in deterministic order with optional names', async () => {
    const http = httpByUrl(success([
      product({ id: 'ETH-USD', base_currency: 'ETH' }),
      product(),
      product({ id: 'BTC-EUR', quote_currency: 'EUR' }),
      product({ id: 'DOGE-USD', base_currency: 'DOGE', status: 'offline' }),
      product({ id: 'SOL-USD', base_currency: 'SOL', trading_disabled: true }),
    ]), success([{ id: 'BTC', name: 'Bitcoin' }, { id: 'ETH', name: 'Ethereum' }]));
    const source = createCoinbaseCatalogSource(http);
    const page = await source.page(0, 10);
    expect(page).toEqual({ ok: true, assets: [
      {
        instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
        symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD', coingeckoId: null,
      },
      {
        instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
        symbol: 'ETH', name: 'Ethereum', baseAsset: 'ETH', quoteAsset: 'USD', coingeckoId: null,
      },
    ] });
    expect(page.ok && Object.isFrozen(page.assets)).toBe(true);
    expect(page.ok && Object.isFrozen(page.assets[0])).toBe(true);
  });

  it('searches symbol, product identity, and name after provider validation', async () => {
    const source = createCoinbaseCatalogSource(httpByUrl(success([
      product(), product({ id: 'ETH-USD', base_currency: 'ETH' }),
    ]), success([{ id: 'ETH', name: 'Ethereum' }])));
    expect(await source.search('there', 5)).toMatchObject({
      ok: true, assets: [{ symbol: 'ETH', name: 'Ethereum' }],
    });
    expect(await source.search('btc-usd', 5)).toMatchObject({
      ok: true, assets: [{ symbol: 'BTC' }],
    });
  });

  it('uses canonical symbols as names when optional currency enrichment fails', async () => {
    const failure: HttpResult<unknown> = {
      ok: false, status: 503, reason: 'http', retried: 0,
    };
    expect(await createCoinbaseCatalogSource(httpByUrl(success([product()]), failure)).page(0, 1))
      .toMatchObject({ ok: true, assets: [{ name: 'BTC' }] });
  });

  it.each([
    [success({}), 'invalid_response'],
    [success([product({ id: undefined })]), 'invalid_response'],
    [success([product(), product({ base_currency: 'WBTC' })]), 'conflicting_duplicate'],
  ] as const)('fails closed on malformed/conflicting product evidence', async (response, code) => {
    expect(await createCoinbaseCatalogSource(httpByUrl(response)).page(0, 10))
      .toEqual({ ok: false, code });
  });

  it('maps provider failure, thrown calls, and caller cancellation to stable codes', async () => {
    const rateLimited: HttpResult<unknown> = {
      ok: false, status: 429, reason: 'http', retried: 2, traceId: 'not-returned',
    };
    expect(await createCoinbaseCatalogSource(httpByUrl(rateLimited)).page(0, 1))
      .toEqual({ ok: false, code: 'rate_limited' });
    const throwing = httpByUrl(success([]));
    vi.mocked(throwing.getJson).mockRejectedValue(new Error('provider diagnostic'));
    expect(await createCoinbaseCatalogSource(throwing).page(0, 1))
      .toEqual({ ok: false, code: 'network' });
    const controller = new AbortController();
    controller.abort();
    const untouched = httpByUrl(success([]));
    expect(await createCoinbaseCatalogSource(untouched).page(0, 1, controller.signal))
      .toEqual({ ok: false, code: 'cancelled' });
    expect(untouched.getJson).not.toHaveBeenCalled();
  });

  it('forwards one caller signal to both public catalog requests', async () => {
    const http = httpByUrl(success([]));
    const controller = new AbortController();
    await createCoinbaseCatalogSource(http).page(0, 1, controller.signal);
    expect(http.getJson).toHaveBeenCalledTimes(2);
    expect(http.getJson).toHaveBeenCalledWith(expect.any(String), { signal: controller.signal });
  });
});
