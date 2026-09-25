import {
  fetchCoinbaseBook, fetchCoinbaseProduct, fetchCoinbaseQuote,
  type CoinbaseBookSnapshot, type CoinbaseProductSnapshot, type CoinbaseQuoteSnapshot,
  type CoinbaseReadHttpClient,
} from '@coqui/adapters';

type Observation<T> = Readonly<{
  state: 'fresh' | 'stale' | 'unavailable'; data: T | null; observedAtMs: number | null;
}>;
type Cache<T> = { data: T; fetchedAtMs: number };
const UNAVAILABLE = { state: 'unavailable', data: null, observedAtMs: null } as const;

export function createCoinbaseMarketDiagnostics(input: {
  readonly client: () => Promise<CoinbaseReadHttpClient | null>;
  readonly nowMs: () => number;
}) {
  const quotes = new Map<string, Cache<CoinbaseQuoteSnapshot>>();
  const products = new Map<string, Cache<CoinbaseProductSnapshot>>();
  const books = new Map<string, Cache<CoinbaseBookSnapshot>>();
  const pending = new Map<string, Promise<unknown>>();

  async function read<T>(kind: string, productId: string, cache: Map<string, Cache<T>>,
    lifetimeMs: number, acquire: (client: CoinbaseReadHttpClient, nowMs: number) => Promise<T | null>,
    timestamp: (data: T, fetchedAtMs: number) => number): Promise<Observation<T>> {
    const key = `${kind}:${productId}`;
    const now = input.nowMs();
    const prior = cache.get(productId);
    if (prior !== undefined && now - prior.fetchedAtMs < lifetimeMs) {
      const observedAtMs = timestamp(prior.data, prior.fetchedAtMs);
      return { state: now - observedAtMs > (kind === 'product' ? 15 * 60_000 : 2 * 60_000)
        ? 'stale' : 'fresh', data: prior.data, observedAtMs };
    }
    let task = pending.get(key) as Promise<T | null> | undefined;
    if (task === undefined) {
      task = (async () => {
        const client = await input.client();
        if (client === null) return null;
        try { return await acquire(client, now); }
        catch { return null; }
        finally { client.destroy(); }
      })();
      pending.set(key, task);
    }
    let value: T | null;
    try { value = await task; }
    finally { if (pending.get(key) === task) pending.delete(key); }
    if (value !== null) {
      cache.set(productId, { data: value, fetchedAtMs: now });
      const observedAtMs = timestamp(value, now);
      return { state: now - observedAtMs > (kind === 'product' ? 15 * 60_000 : 2 * 60_000)
        ? 'stale' : 'fresh', data: value, observedAtMs };
    }
    return prior === undefined ? UNAVAILABLE
      : { state: 'stale', data: prior.data, observedAtMs: timestamp(prior.data, prior.fetchedAtMs) };
  }

  return { async snapshot(productId: string) {
    const [quote, product, book] = await Promise.all([
      read('quote', productId, quotes, 30_000,
        (client, now) => fetchCoinbaseQuote(client, productId, now), (data) => data.observedAtMs),
      read('product', productId, products, 5 * 60_000,
        (client) => fetchCoinbaseProduct(client, productId), (_data, fetchedAtMs) => fetchedAtMs),
      read('book', productId, books, 30_000,
        (client, now) => fetchCoinbaseBook(client, productId, now), (data) => data.observedAtMs),
    ]);
    return { productId, quote, product, book, source: 'coinbase_advanced_trade_rest' as const,
      informationalOnly: true as const, decisionEligible: false as const, asOfMs: input.nowMs() };
  } };
}
