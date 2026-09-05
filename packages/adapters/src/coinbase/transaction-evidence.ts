import {
  decimal,
  type CoinbaseAccountEvidence,
  type CoinbaseTransactionEvidence,
  type DecimalString,
} from '@coqui/core';

import type { CoinbaseEvidenceFailureCode } from './account-evidence.js';
import { COINBASE_API_HOST, type CoinbaseReadHttpClient } from './auth.js';

const MAX_TRANSACTION_ROWS = 100_000;
const MAX_TRANSACTION_PAGES = 1_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const CURRENCY = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;
const PATH = /^\/v2\/accounts\/([0-9a-f-]{36})\/transactions$/iu;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const RESOURCE_PATH = /^\/v2\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,1019}$/u;

export type CoinbaseTransactionAcquisitionResult =
  | { readonly ok: true; readonly rows: readonly CoinbaseTransactionEvidence[]; readonly pageCount: number }
  | { readonly ok: false; readonly code: CoinbaseEvidenceFailureCode };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactDecimal(value: unknown): DecimalString | null {
  if (typeof value !== 'string') return null;
  try {
    return decimal(value);
  } catch {
    return null;
  }
}

function time(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = RFC3339.exec(value);
  if (match === null) return null;
  const probe = new Date(Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
  ));
  if (probe.getUTCFullYear() !== Number(match[1]) ||
    probe.getUTCMonth() !== Number(match[2]) - 1 ||
    probe.getUTCDate() !== Number(match[3]) ||
    probe.getUTCHours() !== Number(match[4]) ||
    probe.getUTCMinutes() !== Number(match[5]) ||
    probe.getUTCSeconds() !== Number(match[6])) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function transaction(value: unknown, accountUuid: string): CoinbaseTransactionEvidence | null {
  const data = record(value);
  const amount = record(data?.['amount']);
  const native = record(data?.['native_amount']);
  if (data === null || amount === null || native === null) return null;
  const transactionId = typeof data['id'] === 'string' && IDENTIFIER.test(data['id'])
    ? data['id'] : null;
  const type = typeof data['type'] === 'string' && TOKEN.test(data['type']) ? data['type'] : null;
  const status = typeof data['status'] === 'string' && TOKEN.test(data['status'])
    ? data['status'] : null;
  const amountValue = exactDecimal(amount['amount']);
  const nativeValue = exactDecimal(native['amount']);
  const amountCurrency = typeof amount['currency'] === 'string' && CURRENCY.test(amount['currency'])
    ? amount['currency'] : null;
  const nativeCurrency = typeof native['currency'] === 'string' && CURRENCY.test(native['currency'])
    ? native['currency'] : null;
  const createdAtMs = time(data['created_at']);
  const updatedAtMs = data['updated_at'] === undefined || data['updated_at'] === null
    ? null
    : time(data['updated_at']) ?? undefined;
  const resourcePath = typeof data['resource_path'] === 'string' &&
    RESOURCE_PATH.test(data['resource_path']) ? data['resource_path'] : null;
  if (transactionId === null || type === null || status === null || amountValue === null ||
    nativeValue === null || amountCurrency === null || nativeCurrency === null ||
    createdAtMs === null || updatedAtMs === undefined ||
    (updatedAtMs !== null && updatedAtMs < createdAtMs) || resourcePath === null) return null;
  return Object.freeze({
    transactionId, accountUuid, type, status,
    amount: amountValue, amountCurrency, nativeAmount: nativeValue, nativeCurrency,
    createdAtMs, updatedAtMs, resourcePath,
  });
}

function nextUrl(value: unknown, accountUuid: string): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try {
    const parsed = new URL(value, `https://${COINBASE_API_HOST}`);
    const match = PATH.exec(parsed.pathname);
    if (parsed.protocol !== 'https:' || parsed.hostname !== COINBASE_API_HOST ||
      parsed.port !== '' || parsed.username !== '' || parsed.password !== '' ||
      parsed.hash !== '' || match?.[1]?.toLowerCase() !== accountUuid.toLowerCase()) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function failure(result: { readonly status: number; readonly reason: string }): CoinbaseEvidenceFailureCode {
  if (result.reason === 'canceled') return 'cancelled';
  if (result.reason === 'shutdown') return 'shutdown';
  if (result.reason === 'elapsed-budget') return 'elapsed_budget_exhausted';
  if (result.reason === 'timeout') return 'timeout';
  if (result.status === 0) return 'network';
  if (result.status === 401) return 'unauthorized';
  if (result.status === 403) return 'forbidden';
  if (result.status === 429) return 'rate_limited';
  return 'http';
}

/** Read complete V2 transaction evidence for every Coinbase account without mutating funds. */
export async function fetchCoinbaseTransactionEvidence(
  http: Pick<CoinbaseReadHttpClient, 'getJson'>,
  accounts: readonly CoinbaseAccountEvidence[],
  signal?: AbortSignal,
): Promise<CoinbaseTransactionAcquisitionResult> {
  const rows = new Map<string, CoinbaseTransactionEvidence>();
  let pageCount = 0;
  for (const account of accounts) {
    let url: string | null = `https://${COINBASE_API_HOST}/v2/accounts/${account.accountUuid}/transactions?limit=100`;
    const cursors = new Set<string>();
    while (url !== null) {
      if (signal?.aborted) return { ok: false, code: 'cancelled' };
      if (pageCount >= MAX_TRANSACTION_PAGES) return { ok: false, code: 'response_too_large' };
      let result: Awaited<ReturnType<typeof http.getJson<unknown>>>;
      try {
        result = await http.getJson<unknown>(
          url,
          signal === undefined ? undefined : { signal },
        );
      } catch {
        return { ok: false, code: signal?.aborted ? 'cancelled' : 'network' };
      }
      if (!result.ok) return { ok: false, code: failure(result) };
      const body = record(result.data);
      const pagination = record(body?.['pagination']);
      if (body === null || pagination === null || !Array.isArray(body['data'])) {
        return { ok: false, code: 'invalid_response' };
      }
      pageCount += 1;
      for (const raw of body['data']) {
        const parsed = transaction(raw, account.accountUuid);
        if (parsed === null) return { ok: false, code: 'invalid_response' };
        const identity = `${parsed.accountUuid}:${parsed.transactionId}`;
        const prior = rows.get(identity);
        if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(parsed)) {
          return { ok: false, code: 'conflicting_duplicate' };
        }
        rows.set(identity, parsed);
        if (rows.size > MAX_TRANSACTION_ROWS) return { ok: false, code: 'response_too_large' };
      }
      const next = nextUrl(pagination['next_uri'], account.accountUuid);
      if (next === undefined) return { ok: false, code: 'invalid_response' };
      if (next !== null && cursors.has(next)) return { ok: false, code: 'pagination_cycle' };
      if (next !== null) cursors.add(next);
      url = next;
    }
  }
  return { ok: true, rows: Object.freeze([...rows.values()]), pageCount };
}
