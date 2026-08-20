import { instrumentKey, type AssetRef } from '@coqui/core';

import type { HttpClient, HttpFailure } from '../http/index.js';
import { COINBASE_EXCHANGE_HOST } from './public.js';

const PRODUCTS_URL = `https://${COINBASE_EXCHANGE_HOST}/products`;
const CURRENCIES_URL = `https://${COINBASE_EXCHANGE_HOST}/currencies`;
const MAX_PRODUCTS = 10_000;
const PRODUCT = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;
const ASSET = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;

export type CoinbaseCatalogFailureCode =
  | 'cancelled'
  | 'shutdown'
  | 'elapsed_budget_exhausted'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'http'
  | 'invalid_response'
  | 'response_too_large'
  | 'conflicting_duplicate';

export type CoinbaseCatalogResult =
  | { readonly ok: true; readonly assets: readonly AssetRef[] }
  | { readonly ok: false; readonly code: CoinbaseCatalogFailureCode };

export interface CoinbaseCatalogSource {
  search(query: string, limit: number, signal?: AbortSignal): Promise<CoinbaseCatalogResult>;
  page(offset: number, limit: number, signal?: AbortSignal): Promise<CoinbaseCatalogResult>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function failure(value: HttpFailure): CoinbaseCatalogFailureCode {
  if (value.reason === 'canceled') return 'cancelled';
  if (value.reason === 'shutdown') return 'shutdown';
  if (value.reason === 'elapsed-budget') return 'elapsed_budget_exhausted';
  if (value.reason === 'timeout') return 'timeout';
  if (value.reason === 'parse' || value.reason === 'serialize') return 'invalid_response';
  if (value.status === 0) return 'network';
  if (value.status === 429) return 'rate_limited';
  return 'http';
}

function parseCurrencyNames(value: unknown): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(value)) return names;
  for (const candidate of value) {
    const row = record(candidate);
    if (row === null || typeof row['id'] !== 'string' || typeof row['name'] !== 'string') continue;
    const id = row['id'].trim().toUpperCase();
    const name = row['name'].trim();
    if (ASSET.test(id) && name.length > 0 && name.length <= 160) names.set(id, name);
  }
  return names;
}

function parseProduct(value: unknown, names: ReadonlyMap<string, string>): AssetRef | null | false {
  const row = record(value);
  if (row === null) return false;
  const rawId = row['id'];
  const rawBase = row['base_currency'];
  const rawQuote = row['quote_currency'];
  const rawStatus = row['status'];
  if (
    typeof rawId !== 'string' || typeof rawBase !== 'string' ||
    typeof rawQuote !== 'string' || typeof rawStatus !== 'string' ||
    (row['trading_disabled'] !== undefined && typeof row['trading_disabled'] !== 'boolean')
  ) return false;
  const productId = rawId.trim().toUpperCase();
  const baseAsset = rawBase.trim().toUpperCase();
  const quoteAsset = rawQuote.trim().toUpperCase();
  if (!PRODUCT.test(productId) || !ASSET.test(baseAsset) || !ASSET.test(quoteAsset)) return false;
  if (quoteAsset !== 'USD' || rawStatus !== 'online' || row['trading_disabled'] === true) return null;
  const asset: AssetRef = {
    instrument: { venue: 'coinbase', productId, productType: 'spot' },
    symbol: baseAsset,
    name: names.get(baseAsset) ?? baseAsset,
    baseAsset,
    quoteAsset: 'USD',
    coingeckoId: null,
  };
  try {
    instrumentKey(asset.instrument);
  } catch {
    return false;
  }
  return Object.freeze(asset);
}

function sameAsset(left: AssetRef, right: AssetRef): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function fetchCatalog(http: HttpClient, signal?: AbortSignal): Promise<CoinbaseCatalogResult> {
  if (signal?.aborted) return { ok: false, code: 'cancelled' };
  let products: Awaited<ReturnType<HttpClient['getJson']>>;
  let currencies: Awaited<ReturnType<HttpClient['getJson']>>;
  try {
    [products, currencies] = await Promise.all([
      http.getJson<unknown>(PRODUCTS_URL, signal === undefined ? undefined : { signal }),
      http.getJson<unknown>(CURRENCIES_URL, signal === undefined ? undefined : { signal }),
    ]);
  } catch {
    return { ok: false, code: signal?.aborted ? 'cancelled' : 'network' };
  }
  if (!products.ok) return { ok: false, code: failure(products) };
  if (!Array.isArray(products.data)) return { ok: false, code: 'invalid_response' };
  if (products.data.length > MAX_PRODUCTS) return { ok: false, code: 'response_too_large' };
  if (!currencies.ok && signal?.aborted) return { ok: false, code: 'cancelled' };
  const names = currencies.ok ? parseCurrencyNames(currencies.data) : new Map<string, string>();
  const unique = new Map<string, AssetRef>();
  for (const product of products.data) {
    const asset = parseProduct(product, names);
    if (asset === false) return { ok: false, code: 'invalid_response' };
    if (asset === null) continue;
    const key = instrumentKey(asset.instrument);
    const prior = unique.get(key);
    if (prior && !sameAsset(prior, asset)) return { ok: false, code: 'conflicting_duplicate' };
    unique.set(key, asset);
  }
  return {
    ok: true,
    assets: Object.freeze([...unique.values()].sort(
      (left, right) => left.symbol.localeCompare(right.symbol) ||
        left.instrument.productId.localeCompare(right.instrument.productId),
    )),
  };
}

/** Complete public Coinbase USD spot catalog with bounded local search/paging. */
export function createCoinbaseCatalogSource(http: HttpClient): CoinbaseCatalogSource {
  return Object.freeze({
    async search(query: string, limit: number, signal?: AbortSignal) {
      const result = await fetchCatalog(http, signal);
      if (!result.ok) return result;
      const normalized = query.trim().toLowerCase();
      return {
        ok: true as const,
        assets: Object.freeze(result.assets.filter((asset) =>
          asset.symbol.toLowerCase().includes(normalized) ||
          asset.name.toLowerCase().includes(normalized) ||
          asset.instrument.productId.toLowerCase().includes(normalized))
          .slice(0, limit)),
      };
    },
    async page(offset: number, limit: number, signal?: AbortSignal) {
      const result = await fetchCatalog(http, signal);
      return result.ok
        ? { ok: true as const, assets: Object.freeze(result.assets.slice(offset, offset + limit)) }
        : result;
    },
  });
}
