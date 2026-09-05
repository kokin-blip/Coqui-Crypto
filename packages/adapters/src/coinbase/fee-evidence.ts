import {
  nonNegativeDecimal,
  type CoinbaseFeeTierEvidence,
  type DecimalString,
} from '@coqui/core';

import type { CoinbaseEvidenceFailureCode } from './account-evidence.js';
import { COINBASE_API_HOST, type CoinbaseReadHttpClient } from './auth.js';

const URL = `https://${COINBASE_API_HOST}/api/v3/brokerage/transaction_summary?product_type=SPOT&product_venue=CBE`;
const TIER = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;

export type CoinbaseFeeTierResult =
  | { readonly ok: true; readonly value: CoinbaseFeeTierEvidence }
  | { readonly ok: false; readonly code: CoinbaseEvidenceFailureCode };

function exact(value: unknown): DecimalString | null {
  if (typeof value !== 'string') return null;
  try {
    return nonNegativeDecimal(value);
  } catch {
    return null;
  }
}

function failure(status: number, reason: string): CoinbaseEvidenceFailureCode {
  if (reason === 'canceled') return 'cancelled';
  if (reason === 'shutdown') return 'shutdown';
  if (reason === 'elapsed-budget') return 'elapsed_budget_exhausted';
  if (reason === 'timeout') return 'timeout';
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  return 'http';
}

/** Read exact string fee-tier facts; aggregate JSON numbers are deliberately not coerced. */
export async function fetchCoinbaseFeeTierEvidence(
  http: Pick<CoinbaseReadHttpClient, 'getJson'>,
  signal?: AbortSignal,
): Promise<CoinbaseFeeTierResult> {
  let result: Awaited<ReturnType<typeof http.getJson<unknown>>>;
  try {
    result = await http.getJson<unknown>(URL, signal === undefined ? undefined : { signal });
  } catch {
    return { ok: false, code: signal?.aborted ? 'cancelled' : 'network' };
  }
  if (!result.ok) return { ok: false, code: failure(result.status, result.reason) };
  const body = typeof result.data === 'object' && result.data !== null && !Array.isArray(result.data)
    ? result.data as Record<string, unknown> : null;
  const raw = typeof body?.['fee_tier'] === 'object' && body['fee_tier'] !== null &&
    !Array.isArray(body['fee_tier'])
    ? body['fee_tier'] as Record<string, unknown> : null;
  if (raw === null || typeof raw['pricing_tier'] !== 'string' ||
    !TIER.test(raw['pricing_tier'])) return { ok: false, code: 'invalid_response' };
  const makerFeeRate = exact(raw['maker_fee_rate']);
  const takerFeeRate = exact(raw['taker_fee_rate']);
  const usdFrom = exact(raw['usd_from']);
  const usdTo = raw['usd_to'] === undefined || raw['usd_to'] === null || raw['usd_to'] === ''
    ? null : exact(raw['usd_to']);
  if (makerFeeRate === null || takerFeeRate === null || usdFrom === null ||
    (raw['usd_to'] !== undefined && raw['usd_to'] !== null && raw['usd_to'] !== '' &&
      usdTo === null)) return { ok: false, code: 'invalid_response' };
  return { ok: true, value: Object.freeze({
    pricingTier: raw['pricing_tier'], makerFeeRate, takerFeeRate, usdFrom, usdTo,
  }) };
}
