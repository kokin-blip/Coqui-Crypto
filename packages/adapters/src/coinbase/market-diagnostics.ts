import type { CoinbaseReadHttpClient } from './auth.js';

export type CoinbaseBookLevel = Readonly<{ price: string; size: string }>;
export type CoinbaseQuoteSnapshot = Readonly<{ bid: string; ask: string; observedAtMs: number }>;
export type CoinbaseProductSnapshot = Readonly<{
  status: string; tradingDisabled: boolean; cancelOnly: boolean;
  limitOnly: boolean; postOnly: boolean; baseIncrement: string;
  quoteIncrement: string; quoteMinSize: string;
}>;
export type CoinbaseBookSnapshot = Readonly<{
  bids: readonly CoinbaseBookLevel[]; asks: readonly CoinbaseBookLevel[]; observedAtMs: number;
}>;

function row(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function decimal(value: unknown, positive = true): string | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && (positive ? number > 0 : number >= 0) ? value : null;
}

function time(value: unknown, nowMs: number): number | null {
  if (typeof value !== 'string') return null;
  const atMs = Date.parse(value);
  return Number.isSafeInteger(atMs) && atMs > 0 && atMs <= nowMs + 60_000 ? atMs : null;
}

function levels(value: unknown, descending: boolean): readonly CoinbaseBookLevel[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const parsed: CoinbaseBookLevel[] = [];
  for (const item of value) {
    const level = row(item);
    const price = decimal(level?.['price']), size = decimal(level?.['size'], false);
    if (price === null || size === null) return null;
    if (parsed.length > 0 && (descending
      ? Number(price) > Number(parsed.at(-1)!.price)
      : Number(price) < Number(parsed.at(-1)!.price))) return null;
    parsed.push({ price, size });
  }
  return parsed;
}

export function parseCoinbaseQuote(value: unknown, productId: string, nowMs: number): CoinbaseQuoteSnapshot | null {
  const books = row(value)?.['pricebooks'];
  if (!Array.isArray(books) || books.length !== 1) return null;
  const book = row(books[0]);
  if (book?.['product_id'] !== productId) return null;
  const bids = levels(book['bids'], true), asks = levels(book['asks'], false);
  const observedAtMs = time(book['time'], nowMs);
  if (bids?.length !== 1 || asks?.length !== 1 || observedAtMs === null ||
      Number(bids[0]!.price) > Number(asks[0]!.price)) return null;
  return { bid: bids[0]!.price, ask: asks[0]!.price, observedAtMs };
}

export function parseCoinbaseProduct(value: unknown, productId: string): CoinbaseProductSnapshot | null {
  const product = row(value);
  if (product?.['product_id'] !== productId || typeof product['status'] !== 'string' ||
      product['status'].length === 0 || product['status'].length > 64 ||
      product['product_type'] !== 'SPOT' ||
      typeof product['trading_disabled'] !== 'boolean' ||
      typeof product['cancel_only'] !== 'boolean' ||
      typeof product['limit_only'] !== 'boolean' ||
      typeof product['post_only'] !== 'boolean') return null;
  const baseIncrement = decimal(product['base_increment']);
  const quoteIncrement = decimal(product['quote_increment']);
  const quoteMinSize = decimal(product['quote_min_size']);
  if (baseIncrement === null || quoteIncrement === null || quoteMinSize === null) return null;
  return { status: product['status'], tradingDisabled: product['trading_disabled'],
    cancelOnly: product['cancel_only'], limitOnly: product['limit_only'],
    postOnly: product['post_only'], baseIncrement, quoteIncrement, quoteMinSize };
}

export function parseCoinbaseBook(value: unknown, productId: string, nowMs: number): CoinbaseBookSnapshot | null {
  const book = row(row(value)?.['pricebook']);
  if (book?.['product_id'] !== productId) return null;
  const bids = levels(book['bids'], true), asks = levels(book['asks'], false);
  const observedAtMs = time(book['time'], nowMs);
  if (bids === null || asks === null || observedAtMs === null ||
      (bids.length > 0 && asks.length > 0 && Number(bids[0]!.price) > Number(asks[0]!.price))) return null;
  return { bids, asks, observedAtMs };
}

export async function fetchCoinbaseQuote(client: Pick<CoinbaseReadHttpClient, 'getJson'>,
  productId: string, nowMs: number): Promise<CoinbaseQuoteSnapshot | null> {
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/u.test(productId)) return null;
  const root = 'https://api.coinbase.com/api/v3/brokerage';
  const result = await client.getJson<unknown>(`${root}/best_bid_ask?product_ids=${encodeURIComponent(productId)}`);
  return result.ok ? parseCoinbaseQuote(result.data, productId, nowMs) : null;
}

export async function fetchCoinbaseProduct(client: Pick<CoinbaseReadHttpClient, 'getJson'>,
  productId: string): Promise<CoinbaseProductSnapshot | null> {
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/u.test(productId)) return null;
  const result = await client.getJson<unknown>(
    `https://api.coinbase.com/api/v3/brokerage/products/${encodeURIComponent(productId)}`);
  return result.ok ? parseCoinbaseProduct(result.data, productId) : null;
}

export async function fetchCoinbaseBook(client: Pick<CoinbaseReadHttpClient, 'getJson'>,
  productId: string, nowMs: number): Promise<CoinbaseBookSnapshot | null> {
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/u.test(productId)) return null;
  const result = await client.getJson<unknown>(
    `https://api.coinbase.com/api/v3/brokerage/product_book?product_id=${encodeURIComponent(productId)}&limit=10`);
  return result.ok ? parseCoinbaseBook(result.data, productId, nowMs) : null;
}
