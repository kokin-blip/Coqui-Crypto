import {
  nonNegativeDecimal,
  type UniverseProductObservation,
} from '@coqui/core';

import type { HttpClient, HttpResult } from '../http/index.js';
import { COINBASE_EXCHANGE_HOST } from './public.js';

const INVALID = Symbol('invalid');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalBoolean(value: unknown): boolean | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  return typeof value === 'boolean' ? value : INVALID;
}

function optionalDecimal(value: unknown): string | null | typeof INVALID {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return INVALID;
  try {
    return nonNegativeDecimal(value);
  } catch {
    return INVALID;
  }
}

function parseProduct(value: unknown): UniverseProductObservation | null | typeof INVALID {
  if (!isRecord(value)) return INVALID;
  const quote = value['quote_currency'];
  if (typeof quote !== 'string') return INVALID;
  if (quote !== 'USD') return null;
  const id = value['id'];
  const base = value['base_currency'];
  const status = value['status'];
  if (typeof id !== 'string' || typeof base !== 'string' || typeof status !== 'string') {
    return INVALID;
  }
  const tradingDisabled = optionalBoolean(value['trading_disabled']);
  const cancelOnly = optionalBoolean(value['cancel_only']);
  const limitOnly = optionalBoolean(value['limit_only']);
  const postOnly = optionalBoolean(value['post_only']);
  const baseIncrement = optionalDecimal(value['base_increment']);
  const quoteIncrement = optionalDecimal(value['quote_increment']);
  const minMarketFunds = optionalDecimal(value['min_market_funds']);
  if ([tradingDisabled, cancelOnly, limitOnly, postOnly, baseIncrement,
    quoteIncrement, minMarketFunds].includes(INVALID)) return INVALID;
  return {
    instrument: { venue: 'coinbase', productId: id, productType: 'spot' },
    baseAsset: base,
    quoteAsset: 'USD',
    status,
    tradingDisabled: tradingDisabled as boolean | null,
    cancelOnly: cancelOnly as boolean | null,
    limitOnly: limitOnly as boolean | null,
    postOnly: postOnly as boolean | null,
    baseIncrement: baseIncrement as string | null,
    quoteIncrement: quoteIncrement as string | null,
    minMarketFunds: minMarketFunds as string | null,
  };
}

/** Fetch one complete Coinbase USD product observation; malformed rows fail the batch. */
export async function fetchCoinbaseUniverseProducts(
  http: HttpClient,
): Promise<HttpResult<UniverseProductObservation[]>> {
  const result = await http.getJson<unknown>(`https://${COINBASE_EXCHANGE_HOST}/products`);
  if (!result.ok) return result;
  if (!Array.isArray(result.data)) {
    return { ok: false, status: result.status, reason: 'parse', retried: 0 };
  }
  const products: UniverseProductObservation[] = [];
  for (const value of result.data) {
    const parsed = parseProduct(value);
    if (parsed === INVALID) {
      return { ok: false, status: result.status, reason: 'parse', retried: 0 };
    }
    if (parsed) products.push(parsed);
  }
  return { ok: true, status: result.status, data: products };
}
