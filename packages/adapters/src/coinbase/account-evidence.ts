import {
  coinbaseAccountTotalQuantity,
  coinbaseEvidenceDatasetHash,
  nonNegativeDecimal,
  type CoinbaseAccountEvidence,
  type CoinbaseFillEvidence,
  type DecimalString,
} from '@coqui/core';

import type { HttpFailure } from '../http/index.js';
import { COINBASE_API_HOST, type CoinbaseReadHttpClient } from './auth.js';

const BASE_URL = `https://${COINBASE_API_HOST}/api/v3/brokerage`;
const MAX_ACCOUNT_ROWS = 10_000;
const MAX_FILL_ROWS = 100_000;
const MAX_PAGES = 1_000;
const ACCOUNT_PAGE_SIZE = 250;
const FILL_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CURRENCY_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const PRODUCT_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/u;
const CURSOR_PATTERN = /^[A-Za-z0-9._~+/=-]{1,4096}$/u;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

export type CoinbaseEvidenceFailureCode =
  | 'cancelled'
  | 'shutdown'
  | 'elapsed_budget_exhausted'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'http'
  | 'invalid_response'
  | 'pagination_cycle'
  | 'response_too_large'
  | 'conflicting_duplicate'
  | 'proof_token_required';

export interface CoinbaseEvidenceAcquisition {
  readonly accounts: readonly CoinbaseAccountEvidence[];
  readonly fills: readonly CoinbaseFillEvidence[];
  readonly accountPageCount: number;
  readonly fillPageCount: number;
  readonly datasetHash: string;
}

export type CoinbaseEvidenceAcquisitionResult =
  | { readonly ok: true; readonly value: CoinbaseEvidenceAcquisition }
  | {
      readonly ok: false;
      readonly code: CoinbaseEvidenceFailureCode;
      readonly resource: 'accounts' | 'fills';
    };

interface Page<T> {
  readonly rows: readonly T[];
  readonly hasNext: boolean;
  readonly cursor: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(
  value: unknown,
  pattern: RegExp,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return pattern.test(normalized) ? normalized : null;
}

function exactNonNegative(value: unknown, positive = false): DecimalString | null {
  if (typeof value !== 'string') return null;
  try {
    const normalized = nonNegativeDecimal(value);
    if (positive && /^0(?:\.0+)?$/u.test(normalized)) return null;
    return normalized;
  } catch {
    return null;
  }
}

function timestamp(value: unknown, optional = false): number | null | undefined {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || value.length > 64 || !RFC3339_PATTERN.test(value)) {
    return undefined;
  }
  const calendar = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u.exec(value);
  if (calendar === null) return undefined;
  const [, year, month, day, hour, minute, second] = calendar;
  const calendarProbe = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
  ));
  if (
    calendarProbe.getUTCFullYear() !== Number(year) ||
    calendarProbe.getUTCMonth() !== Number(month) - 1 ||
    calendarProbe.getUTCDate() !== Number(day) ||
    calendarProbe.getUTCHours() !== Number(hour) ||
    calendarProbe.getUTCMinutes() !== Number(minute) ||
    calendarProbe.getUTCSeconds() !== Number(second)
  ) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? milliseconds
    : undefined;
}

function parseAccount(value: unknown): CoinbaseAccountEvidence | null {
  const data = record(value);
  const available = record(data?.['available_balance']);
  const hold = record(data?.['hold']);
  if (data === null || available === null || hold === null) return null;
  const accountUuid = requiredString(data['uuid'], UUID_PATTERN);
  const currency = requiredString(data['currency'], CURRENCY_PATTERN);
  const availableCurrency = requiredString(available['currency'], CURRENCY_PATTERN);
  const holdCurrency = requiredString(hold['currency'], CURRENCY_PATTERN);
  const availableQuantity = exactNonNegative(available['value']);
  const holdQuantity = exactNonNegative(hold['value']);
  const providerUpdatedAtMs = timestamp(data['updated_at'], true);
  if (
    accountUuid === null || currency === null || availableCurrency !== currency ||
    holdCurrency !== currency || availableQuantity === null || holdQuantity === null ||
    providerUpdatedAtMs === undefined || typeof data['active'] !== 'boolean' ||
    typeof data['ready'] !== 'boolean' || typeof data['default'] !== 'boolean'
  ) return null;
  return Object.freeze({
    accountUuid,
    currency,
    availableQuantity,
    holdQuantity,
    totalQuantity: coinbaseAccountTotalQuantity(availableQuantity, holdQuantity),
    active: data['active'],
    ready: data['ready'],
    defaultAccount: data['default'],
    providerUpdatedAtMs,
  });
}

function parseFill(value: unknown): CoinbaseFillEvidence | null {
  const data = record(value);
  if (data === null || data['trade_type'] !== 'FILL') return null;
  const tradeId = requiredString(data['trade_id'], IDENTIFIER_PATTERN);
  const orderId = requiredString(data['order_id'], IDENTIFIER_PATTERN);
  const productId = requiredString(data['product_id'], PRODUCT_PATTERN);
  const price = exactNonNegative(data['price'], true);
  const size = exactNonNegative(data['size'], true);
  const commission = exactNonNegative(data['commission']);
  const tradeAtMs = timestamp(data['trade_time']);
  const sequenceAtMs = timestamp(data['sequence_timestamp']);
  if (
    tradeId === null || orderId === null || productId === null || price === null ||
    size === null || commission === null || tradeAtMs === undefined || tradeAtMs === null ||
    sequenceAtMs === undefined || sequenceAtMs === null ||
    (data['side'] !== 'BUY' && data['side'] !== 'SELL') ||
    typeof data['size_in_quote'] !== 'boolean'
  ) return null;
  return Object.freeze({
    tradeId,
    orderId,
    productId,
    side: data['side'],
    price,
    size,
    commission,
    sizeInQuote: data['size_in_quote'],
    tradeAtMs,
    sequenceAtMs,
  });
}

function cursor(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && CURSOR_PATTERN.test(value) ? value : undefined;
}

function parsePage<T>(
  value: unknown,
  key: 'accounts' | 'fills',
  parseRow: (row: unknown) => T | null,
): Page<T> | null {
  const data = record(value);
  if (data === null || !Array.isArray(data[key]) || typeof data['has_next'] !== 'boolean') {
    return null;
  }
  const nextCursor = cursor(data['cursor']);
  if (nextCursor === undefined || (data['has_next'] && nextCursor === null)) return null;
  const rows: T[] = [];
  for (const valueRow of data[key]) {
    const row = parseRow(valueRow);
    if (row === null) return null;
    rows.push(row);
  }
  return { rows, hasNext: data['has_next'], cursor: nextCursor };
}

function classifyHttpFailure(failure: HttpFailure): CoinbaseEvidenceFailureCode {
  if (failure.reason === 'canceled') return 'cancelled';
  if (failure.reason === 'shutdown') return 'shutdown';
  if (failure.reason === 'elapsed-budget') return 'elapsed_budget_exhausted';
  if (failure.reason === 'timeout') return 'timeout';
  if (failure.status === 0) return 'network';
  if (failure.status === 401) return 'unauthorized';
  if (failure.status === 403) return 'forbidden';
  if (failure.status === 429) return 'rate_limited';
  return 'http';
}

function sameRow(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function fetchPages<T extends CoinbaseAccountEvidence | CoinbaseFillEvidence>(
  http: Pick<CoinbaseReadHttpClient, 'getJson'>,
  resource: 'accounts' | 'fills',
  parseRow: (row: unknown) => T | null,
  key: (row: T) => string,
  rowLimit: number,
  signal?: AbortSignal,
): Promise<
  | { ok: true; rows: readonly T[]; pageCount: number }
  | { ok: false; code: CoinbaseEvidenceFailureCode }
> {
  const unique = new Map<string, T>();
  const cursors = new Set<string>();
  let nextCursor: string | null = null;
  let pageCount = 0;
  let complete = false;
  while (!complete) {
    if (signal?.aborted) return { ok: false, code: 'cancelled' };
    if (pageCount >= MAX_PAGES) return { ok: false, code: 'response_too_large' };
    const query = new URLSearchParams({
      limit: String(resource === 'accounts' ? ACCOUNT_PAGE_SIZE : FILL_PAGE_SIZE),
    });
    if (resource === 'fills') query.set('product_types', 'SPOT');
    if (nextCursor !== null) query.set('cursor', nextCursor);
    let result: Awaited<ReturnType<typeof http.getJson<unknown>>>;
    try {
      result = await http.getJson<unknown>(
        `${BASE_URL}/${resource === 'fills' ? 'orders/historical/fills' : 'accounts'}?${query.toString()}`,
        signal === undefined ? undefined : { signal },
      );
    } catch {
      return { ok: false, code: signal?.aborted ? 'cancelled' : 'network' };
    }
    if (!result.ok) return { ok: false, code: classifyHttpFailure(result) };
    const raw = record(result.data);
    if (resource === 'fills' && raw?.['proof_token_required'] !== undefined) {
      if (typeof raw['proof_token_required'] !== 'boolean') {
        return { ok: false, code: 'invalid_response' };
      }
      if (raw['proof_token_required']) return { ok: false, code: 'proof_token_required' };
    }
    const page = parsePage(result.data, resource, parseRow);
    if (page === null) return { ok: false, code: 'invalid_response' };
    pageCount += 1;
    for (const row of page.rows) {
      const identity = key(row);
      const prior = unique.get(identity);
      if (prior !== undefined && !sameRow(prior, row)) {
        return { ok: false, code: 'conflicting_duplicate' };
      }
      unique.set(identity, row);
      if (unique.size > rowLimit) return { ok: false, code: 'response_too_large' };
    }
    if (!page.hasNext) {
      complete = true;
    } else {
      nextCursor = page.cursor;
      if (nextCursor === null || cursors.has(nextCursor)) {
        return { ok: false, code: 'pagination_cycle' };
      }
      cursors.add(nextCursor);
    }
  }
  return { ok: true, rows: Object.freeze([...unique.values()]), pageCount };
}

/** Fetch a complete, normalized Coinbase account/fill evidence dataset. */
export async function fetchCoinbaseAccountEvidence(
  http: Pick<CoinbaseReadHttpClient, 'getJson'>,
  signal?: AbortSignal,
): Promise<CoinbaseEvidenceAcquisitionResult> {
  const accounts = await fetchPages(
    http, 'accounts', parseAccount, (row) => row.accountUuid, MAX_ACCOUNT_ROWS, signal,
  );
  if (!accounts.ok) return Object.freeze({ ...accounts, resource: 'accounts' });
  const fills = await fetchPages(
    http, 'fills', parseFill, (row) => row.tradeId, MAX_FILL_ROWS, signal,
  );
  if (!fills.ok) return Object.freeze({ ...fills, resource: 'fills' });
  const value = Object.freeze({
    accounts: accounts.rows,
    fills: fills.rows,
    accountPageCount: accounts.pageCount,
    fillPageCount: fills.pageCount,
    datasetHash: coinbaseEvidenceDatasetHash(accounts.rows, fills.rows),
  });
  return Object.freeze({ ok: true, value });
}
