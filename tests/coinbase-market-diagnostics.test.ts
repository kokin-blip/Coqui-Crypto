import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createCoinbaseReadHttpClient,
  fetchCoinbaseBook, fetchCoinbaseProduct, fetchCoinbaseQuote,
  parseCoinbaseBook, parseCoinbaseProduct, parseCoinbaseQuote,
  type CoinbaseReadHttpClient } from '../packages/adapters/src/index.js';
import { createCoinbaseMarketDiagnostics } from '../apps/desktop/src/main/coinbase-market-diagnostics.js';

const NOW = Date.UTC(2026, 8, 25, 12);
const AT = new Date(NOW - 1_000).toISOString();
const quote = { pricebooks: [{ product_id: 'BTC-USD', bids: [{ price: '100', size: '2' }],
  asks: [{ price: '101', size: '3' }], time: AT }] };
const product = { product_id: 'BTC-USD', product_type: 'SPOT', status: 'online',
  trading_disabled: false, cancel_only: false, limit_only: false, post_only: false,
  base_increment: '0.0001', quote_increment: '0.01', quote_min_size: '1' };
const book = { pricebook: { product_id: 'BTC-USD', bids: [{ price: '100', size: '2' }],
  asks: [{ price: '101', size: '3' }], time: AT } };

function client(data: (url: string) => unknown): CoinbaseReadHttpClient {
  return { getJson: async <T>(url: string) => ({ ok: true as const, status: 200, data: data(url) as T }),
    destroy: vi.fn() };
}

describe('Coinbase market diagnostics', () => {
  it('requests the three authenticated GET routes for BTC, ETH, and LTC', async () => {
    for (const productId of ['BTC-USD', 'ETH-USD', 'LTC-USD']) {
      const seen: string[] = [];
      const mock = client((url) => { seen.push(url); return url.includes('best_bid_ask')
        ? { pricebooks: [{ ...quote.pricebooks[0], product_id: productId }] }
        : url.includes('product_book') ? { pricebook: { ...book.pricebook, product_id: productId } }
          : { ...product, product_id: productId }; });
      expect(await fetchCoinbaseQuote(mock, productId, NOW)).not.toBeNull();
      expect(await fetchCoinbaseProduct(mock, productId)).not.toBeNull();
      expect(await fetchCoinbaseBook(mock, productId, NOW)).not.toBeNull();
      expect(seen.map((url) => new URL(url).pathname)).toEqual([
        '/api/v3/brokerage/best_bid_ask', `/api/v3/brokerage/products/${productId}`,
        '/api/v3/brokerage/product_book',
      ]);
      expect(new URL(seen[2]!).searchParams.get('limit')).toBe('10');
    }
  });

  it('rejects wrong products, malformed prices, crossed or unsorted books, and future observations', () => {
    expect(parseCoinbaseQuote(quote, 'ETH-USD', NOW)).toBeNull();
    expect(parseCoinbaseQuote({ pricebooks: [{ ...quote.pricebooks[0], bids: [{ price: 'NaN', size: '1' }] }] }, 'BTC-USD', NOW)).toBeNull();
    expect(parseCoinbaseQuote({ pricebooks: [{ ...quote.pricebooks[0], time: new Date(NOW + 120_000).toISOString() }] }, 'BTC-USD', NOW)).toBeNull();
    expect(parseCoinbaseProduct({ ...product, product_id: 'ETH-USD' }, 'BTC-USD')).toBeNull();
    expect(parseCoinbaseProduct({ ...product, quote_min_size: '-1' }, 'BTC-USD')).toBeNull();
    expect(parseCoinbaseBook({ pricebook: { ...book.pricebook, bids: [{ price: '102', size: '2' }] } }, 'BTC-USD', NOW)).toBeNull();
    expect(parseCoinbaseBook({ pricebook: { ...book.pricebook, bids: [{ price: '99', size: '1' }, { price: '100', size: '1' }] } }, 'BTC-USD', NOW)).toBeNull();
  });

  it('accepts an empty book and preserves an old timestamp for stale display', async () => {
    const empty = { pricebook: { ...book.pricebook, bids: [], asks: [] } };
    expect(parseCoinbaseBook(empty, 'BTC-USD', NOW)).toMatchObject({ bids: [], asks: [] });
    const old = { pricebooks: [{ ...quote.pricebooks[0], time: new Date(NOW - 10 * 60_000).toISOString() }] };
    const service = createCoinbaseMarketDiagnostics({ client: async () => client((url) =>
      url.includes('best_bid_ask') ? old : url.includes('product_book') ? empty : product), nowMs: () => NOW });
    const result = await service.snapshot('BTC-USD');
    expect(result.quote.state).toBe('stale');
    expect(result.book.state).toBe('fresh');
    expect(result.product.state).toBe('fresh');
    expect(JSON.stringify(result)).not.toMatch(/api.key|bearer|secret/iu);
  });

  it('returns unavailable without credentials and stale cached data after endpoint failure', async () => {
    let now = NOW;
    let available = true;
    const service = createCoinbaseMarketDiagnostics({ nowMs: () => now,
      client: async () => available ? client((url) => url.includes('best_bid_ask') ? quote
        : url.includes('product_book') ? book : product) : null });
    expect((await service.snapshot('BTC-USD')).quote.state).toBe('fresh');
    available = false;
    now += 31_000;
    expect((await service.snapshot('BTC-USD')).quote.state).toBe('stale');
    expect((await createCoinbaseMarketDiagnostics({ nowMs: () => now,
      client: async () => null }).snapshot('BTC-USD')).quote.state).toBe('unavailable');
  });

  it('uses the existing signed GET-only client without exposing its bearer token', async () => {
    const urls: string[] = [], headers: Headers[] = [];
    const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const signed = createCoinbaseReadHttpClient({ keyName: 'organizations/test/apiKeys/key',
      privateKey: key.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string }, {
      maxRetries: 0,
      fetch: async (url, init) => { urls.push(String(url)); headers.push(new Headers(init?.headers));
        return { ok: true, status: 200, headers: { get: () => null },
          json: async () => quote, text: async () => '' }; },
    });
    try { await fetchCoinbaseQuote(signed, 'BTC-USD', NOW); }
    finally { signed.destroy(); }
    expect(urls[0]).toContain('/best_bid_ask?');
    expect(headers[0]?.get('authorization')).toMatch(/^Bearer /u);
  });
});
