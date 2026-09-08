import { Decimal } from 'decimal.js';

import { nonNegativeDecimal } from '@coqui/core';

import { createHttpClient, type HttpClient, type HttpClientOptions } from '../http/index.js';
import { robinhoodCryptoHeaders, type RobinhoodCryptoCredentials } from './auth.js';

const ORIGIN = 'https://trading.robinhood.com';
const MAX_PAGES = 100;
const MAX_ROWS = 10_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const ASSET = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}-USD$/u;

export type RobinhoodReadFailureCode = 'cancelled' | 'timeout' | 'network' | 'unauthorized' |
  'forbidden' | 'rate_limited' | 'provider_unavailable' | 'invalid_response' | 'pagination_cycle' |
  'response_too_large';
export type RobinhoodReadResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly code: RobinhoodReadFailureCode };

export interface RobinhoodAccount {
  readonly accountNumber: string;
  readonly status: string;
  readonly buyingPower: string;
  readonly buyingPowerCurrency: string;
  readonly apiTradable: boolean;
  readonly feeRatio: string | null;
}
export interface RobinhoodHolding {
  readonly accountNumber: string;
  readonly assetCode: string;
  readonly totalQuantity: string;
  readonly availableQuantity: string;
}
export interface RobinhoodOrder { readonly id: string; readonly accountNumber: string; readonly state: string; readonly symbol: string; }
export interface RobinhoodTradingPair {
  readonly symbol: string; readonly assetCode: string; readonly quoteCode: 'USD';
  readonly assetIncrement: string; readonly quoteIncrement: string;
  readonly maxOrderSize: string; readonly minOrderAmount: string; readonly status: string; readonly apiTradable: boolean;
}
export interface RobinhoodBestPrice { readonly symbol: string; readonly bid: string; readonly ask: string; }
export interface RobinhoodEstimatedPrice {
  readonly symbol: string; readonly side: 'bid' | 'ask' | 'both'; readonly quantity: string;
  readonly bid: string | null; readonly ask: string | null; readonly feeRatio: string; readonly estimatedFee: string;
}
export interface RobinhoodCryptoAccountEvidence {
  readonly accounts: readonly RobinhoodAccount[]; readonly holdings: readonly RobinhoodHolding[];
  readonly openOrders: readonly RobinhoodOrder[]; readonly tradingPairs: readonly RobinhoodTradingPair[];
  readonly bestPrices: readonly RobinhoodBestPrice[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown, pattern = ID): string | null {
  return typeof value === 'string' && pattern.test(value.trim()) ? value.trim() : null;
}
function amount(value: unknown, positive = false): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    const result = nonNegativeDecimal(String(value));
    return positive && new Decimal(result).lte(0) ? null : result;
  } catch { return null; }
}
function boolean(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }

function parseAccount(value: unknown): RobinhoodAccount | null {
  const row = record(value), fee = record(row?.['fee_tier_status']);
  const accountNumber = text(row?.['account_number']);
  const status = text(row?.['status']);
  const buyingPower = amount(row?.['buying_power']);
  const currency = text(row?.['buying_power_currency'], ASSET);
  const apiTradable = boolean(row?.['is_api_tradable']);
  const feeRatio = fee === null ? null : amount(fee['fee_ratio']);
  return accountNumber === null || status === null || buyingPower === null || currency === null ||
    apiTradable === null || (fee !== null && feeRatio === null) ? null : Object.freeze({
      accountNumber, status, buyingPower, buyingPowerCurrency: currency, apiTradable, feeRatio,
    });
}
function parseHolding(value: unknown): RobinhoodHolding | null {
  const row = record(value), accountNumber = text(row?.['account_number']);
  const assetCode = text(row?.['asset_code'], ASSET), totalQuantity = amount(row?.['total_quantity']);
  const availableQuantity = amount(row?.['quantity_available_for_trading']);
  return accountNumber === null || assetCode === null || totalQuantity === null || availableQuantity === null ||
    new Decimal(availableQuantity).gt(totalQuantity) ? null : Object.freeze({ accountNumber, assetCode, totalQuantity, availableQuantity });
}
function parseOrder(value: unknown): RobinhoodOrder | null {
  const row = record(value), id = text(row?.['id'] ?? row?.['order_id']);
  const accountNumber = text(row?.['account_number']), state = text(row?.['state']), symbol = text(row?.['symbol'], SYMBOL);
  return id === null || accountNumber === null || state === null || symbol === null ? null : Object.freeze({ id, accountNumber, state, symbol });
}
function parsePair(value: unknown): RobinhoodTradingPair | null {
  const row = record(value), symbol = text(row?.['symbol'], SYMBOL), assetCode = text(row?.['asset_code'], ASSET);
  const quoteCode = text(row?.['quote_code'], ASSET), assetIncrement = amount(row?.['asset_increment'], true);
  const quoteIncrement = amount(row?.['quote_increment'], true), maxOrderSize = amount(row?.['max_order_size'], true);
  const minOrderAmount = amount(row?.['min_order_amount'] ?? row?.['min_order_size'], true);
  const status = text(row?.['status']), apiTradable = boolean(row?.['is_api_tradable']);
  return symbol === null || assetCode === null || quoteCode !== 'USD' || assetIncrement === null ||
    quoteIncrement === null || maxOrderSize === null || minOrderAmount === null || status === null || apiTradable === null
    ? null : Object.freeze({ symbol, assetCode, quoteCode, assetIncrement, quoteIncrement, maxOrderSize, minOrderAmount, status, apiTradable });
}
function parseBestPrice(value: unknown): RobinhoodBestPrice | null {
  const row = record(value), symbol = text(row?.['symbol'], SYMBOL), bid = amount(row?.['bid'], true), ask = amount(row?.['ask'], true);
  return symbol === null || bid === null || ask === null ? null : Object.freeze({ symbol, bid, ask });
}
function parseEstimated(value: unknown): RobinhoodEstimatedPrice | null {
  const row = record(value), symbol = text(row?.['symbol'], SYMBOL), side = row?.['side'];
  const quantity = amount(row?.['quantity'], true), bid = row?.['bid'] == null ? null : amount(row['bid'], true);
  const ask = row?.['ask'] == null ? null : amount(row['ask'], true), feeRatio = amount(row?.['fee_ratio']);
  const estimatedFee = amount(row?.['est_fee']);
  return symbol === null || !['bid', 'ask', 'both'].includes(String(side)) || quantity === null || feeRatio === null ||
    estimatedFee === null || (bid === null && ask === null) ? null : Object.freeze({
      symbol, side: side as RobinhoodEstimatedPrice['side'], quantity, bid, ask, feeRatio, estimatedFee,
    });
}

function failure(status: number, reason: string): RobinhoodReadFailureCode {
  if (reason === 'canceled' || reason === 'shutdown') return 'cancelled';
  if (reason === 'timeout' || reason === 'elapsed-budget') return 'timeout';
  if (reason === 'network') return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'provider_unavailable' : 'invalid_response';
}

export interface RobinhoodCryptoReadClient {
  accounts(signal?: AbortSignal): Promise<RobinhoodReadResult<readonly RobinhoodAccount[]>>;
  holdings(accountNumber: string, signal?: AbortSignal): Promise<RobinhoodReadResult<readonly RobinhoodHolding[]>>;
  openOrders(accountNumber: string, signal?: AbortSignal): Promise<RobinhoodReadResult<readonly RobinhoodOrder[]>>;
  tradingPairs(signal?: AbortSignal): Promise<RobinhoodReadResult<readonly RobinhoodTradingPair[]>>;
  bestBidAsk(symbols: readonly string[], signal?: AbortSignal): Promise<RobinhoodReadResult<readonly RobinhoodBestPrice[]>>;
  estimatedPrice(symbol: string, side: 'bid' | 'ask' | 'both', quantities: readonly string[], signal?: AbortSignal): Promise<RobinhoodReadResult<readonly RobinhoodEstimatedPrice[]>>;
  acquire(signal?: AbortSignal): Promise<RobinhoodReadResult<RobinhoodCryptoAccountEvidence>>;
  destroy(): void;
}

export function createRobinhoodCryptoReadClient(
  credentials: RobinhoodCryptoCredentials,
  options: Omit<HttpClientOptions, 'prepareAttempt'> & { readonly nowMs?: () => number } = {},
): RobinhoodCryptoReadClient {
  const nowMs = options.nowMs ?? Date.now;
  const http: HttpClient = createHttpClient({ ...options, prepareAttempt(url, init) {
    const parsed = new URL(url);
    if (parsed.origin !== ORIGIN) throw new TypeError('Robinhood pagination left the trusted origin.');
    const path = `${parsed.pathname}${parsed.search}`;
    return { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)),
      ...robinhoodCryptoHeaders(credentials, Math.floor(nowMs() / 1_000), path) } };
  } });

  async function rows<T>(path: string, parser: (value: unknown) => T | null, paginated: boolean, signal?: AbortSignal): Promise<RobinhoodReadResult<readonly T[]>> {
    const output: T[] = [], seen = new Set<string>();
    let next: string | null = `${ORIGIN}${path}`;
    for (let page = 0; next !== null && page < MAX_PAGES; page += 1) {
      if (seen.has(next)) return { ok: false, code: 'pagination_cycle' };
      seen.add(next);
      const response = await http.getJson<unknown>(next, signal === undefined ? undefined : { signal });
      if (!response.ok) return { ok: false, code: failure(response.status, response.reason) };
      const body = record(response.data), raw = body?.['results'];
      if (!Array.isArray(raw)) return { ok: false, code: 'invalid_response' };
      for (const item of raw) {
        const parsed = parser(item);
        if (parsed === null) return { ok: false, code: 'invalid_response' };
        output.push(parsed);
        if (output.length > MAX_ROWS) return { ok: false, code: 'response_too_large' };
      }
      const value = body?.['next'];
      if (!paginated || value == null || value === '') next = null;
      else if (typeof value !== 'string') return { ok: false, code: 'invalid_response' };
      else {
        try { next = new URL(value, ORIGIN).toString(); }
        catch { return { ok: false, code: 'invalid_response' }; }
      }
      if (next !== null) {
        try { if (new URL(next).origin !== ORIGIN) return { ok: false, code: 'invalid_response' }; }
        catch { return { ok: false, code: 'invalid_response' }; }
      }
    }
    if (next !== null) return { ok: false, code: 'response_too_large' };
    return { ok: true, value: Object.freeze(output) };
  }
  const query = (values: readonly [string, string][]) => values.length === 0 ? ''
    : `?${new URLSearchParams(values.map((item) => [...item])).toString()}`;
  const accounts = (signal?: AbortSignal) => rows('/api/v2/crypto/trading/accounts/?limit=100', parseAccount, true, signal);
  const holdings = (accountNumber: string, signal?: AbortSignal) => rows(`/api/v2/crypto/trading/holdings/${query([['account_number', accountNumber], ['limit', '100']])}`, parseHolding, true, signal);
  const openOrders = async (accountNumber: string, signal?: AbortSignal): Promise<RobinhoodReadResult<readonly RobinhoodOrder[]>> => {
    const result = await rows<RobinhoodOrder>(`/api/v2/crypto/trading/orders/${query([['account_number', accountNumber], ['limit', '100']])}`, parseOrder, true, signal);
    return result.ok ? { ok: true, value: Object.freeze(result.value.filter((order) =>
      ['open', 'pending', 'partially_filled'].includes(order.state))) } : result;
  };
  const tradingPairs = (signal?: AbortSignal) => rows('/api/v2/crypto/trading/trading_pairs/?limit=100', parsePair, true, signal);
  const bestBidAsk = (symbols: readonly string[], signal?: AbortSignal) => rows(`/api/v2/crypto/marketdata/best_bid_ask/${query(symbols.map((symbol) => ['symbol', symbol]))}`, parseBestPrice, false, signal);
  const estimatedPrice = (symbol: string, side: 'bid' | 'ask' | 'both', quantities: readonly string[], signal?: AbortSignal) =>
    rows(`/api/v2/crypto/trading/estimated_price/${query([['symbol', symbol], ['side', side], ['quantity', quantities.join(',')]])}`, parseEstimated, false, signal);
  return Object.freeze({
    accounts, holdings, openOrders, tradingPairs, bestBidAsk, estimatedPrice,
    async acquire(signal?: AbortSignal) {
      const accountResult = await accounts(signal);
      if (!accountResult.ok) return accountResult;
      const pairResult = await tradingPairs(signal);
      if (!pairResult.ok) return pairResult;
      const holdingRows: RobinhoodHolding[] = [], orderRows: RobinhoodOrder[] = [];
      for (const account of accountResult.value) {
        const held = await holdings(account.accountNumber, signal);
        if (!held.ok) return held;
        holdingRows.push(...held.value);
        const orders = await openOrders(account.accountNumber, signal);
        if (!orders.ok) return orders;
        orderRows.push(...orders.value);
      }
      const symbols = [...new Set(holdingRows.map((item) => `${item.assetCode}-USD`))].sort();
      const prices = symbols.length === 0 ? { ok: true as const, value: Object.freeze([]) } : await bestBidAsk(symbols, signal);
      if (!prices.ok) return prices;
      return { ok: true as const, value: Object.freeze({ accounts: accountResult.value,
        holdings: Object.freeze(holdingRows), openOrders: Object.freeze(orderRows),
        tradingPairs: pairResult.value, bestPrices: prices.value }) };
    },
    destroy: () => http.destroy(),
  });
}
