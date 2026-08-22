import { sha256Hex, type InstrumentIdentity, type ProductRuleSnapshot } from '@coqui/core';

import type { HttpClient, HttpFailure } from '../http/index.js';
import { COINBASE_EXCHANGE_HOST } from './public.js';

const PRODUCTS_URL = `https://${COINBASE_EXCHANGE_HOST}/products`;
const MAX_PRODUCTS = 10_000;
const POSITIVE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

/**
 * Venue rules a simulated order must satisfy before it can be normalised.
 *
 * `ProductRuleSnapshot` existed in `packages/core/src/paper` with **no producer
 * anywhere** — `saveProductRuleSnapshot` had zero non-test callers, so nothing
 * could normalise a paper order at all. This is that producer.
 *
 * The public `/products` endpoint is the base so paper trading needs no
 * Coinbase credential. It does not carry every field the snapshot declares, and
 * the mapping below is deliberate rather than convenient:
 *
 * - `priceIncrement` ← `quote_increment`. On the Exchange API that *is* the
 *   price tick; there is no separate field.
 * - `quoteMinSize` ← `min_market_funds`, the venue's actual minimum order value.
 * - `baseMinSize` ← `base_increment`, the smallest tradeable unit. The Exchange
 *   endpoint stopped publishing a base minimum, and the guardrails'
 *   `minUsefulTradeUsd` floor already refuses dust well above this.
 * - `baseMaxSize` / `quoteMaxSize` ← `null`, which the type permits and
 *   `normalizePaperOrder` treats as unbounded. The endpoint does not publish
 *   them; inventing a cap would be a fabricated constraint.
 *
 * A product missing an increment, or carrying a non-positive one, is **refused
 * rather than defaulted**. A missing safety flag defaults to the *rejecting*
 * value, so an absent `trading_disabled` reads as disabled. The one exception
 * is `viewOnly`, which the Exchange endpoint has no concept of: defaulting it
 * to `true` would make every product unusable and defeat the keyless path, so
 * it is `false` here and the authenticated enrichment may set it.
 */
export type CoinbaseProductRuleFailureCode =
  | 'cancelled'
  | 'shutdown'
  | 'elapsed_budget_exhausted'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'http'
  | 'invalid_response'
  | 'response_too_large';

export type CoinbaseProductRuleResult =
  | { readonly ok: true; readonly rules: readonly ProductRuleSnapshot[] }
  | { readonly ok: false; readonly code: CoinbaseProductRuleFailureCode };

/**
 * Optional authenticated overlay.
 *
 * Kept as an injected port so the base path never depends on a credential.
 * Returning `null` for an instrument leaves the public values in place.
 */
export interface CoinbaseProductRuleEnrichment {
  readonly source: string;
  rules(
    instrument: InstrumentIdentity,
  ): Promise<Partial<Pick<
    ProductRuleSnapshot,
    'baseMinSize' | 'baseMaxSize' | 'quoteMinSize' | 'quoteMaxSize' | 'priceIncrement' | 'viewOnly'
  >> | null>;
}

function failure(value: HttpFailure): CoinbaseProductRuleFailureCode {
  if (value.reason === 'canceled') return 'cancelled';
  if (value.reason === 'shutdown') return 'shutdown';
  if (value.reason === 'elapsed-budget') return 'elapsed_budget_exhausted';
  if (value.reason === 'timeout') return 'timeout';
  if (value.reason === 'parse' || value.reason === 'serialize') return 'invalid_response';
  if (value.status === 0) return 'network';
  if (value.status === 429) return 'rate_limited';
  return 'http';
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A decimal that must be present and strictly greater than zero, or the product is refused. */
function requiredPositive(value: unknown): string | null {
  if (typeof value !== 'string' || !POSITIVE_DECIMAL.test(value)) return null;
  return Number(value) > 0 ? value : null;
}

/** An absent safety flag is treated as engaged. Not knowing is not permission. */
function rejectingBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}

function canonical(row: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(row).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  );
}

function parseProductRules(value: unknown, nowMs: number): ProductRuleSnapshot | null {
  const row = record(value);
  if (row === null) return null;

  const id = row['id'];
  const quote = row['quote_currency'];
  const status = row['status'];
  if (typeof id !== 'string' || quote !== 'USD' || typeof status !== 'string') return null;

  const baseIncrement = requiredPositive(row['base_increment']);
  const quoteIncrement = requiredPositive(row['quote_increment']);
  const minMarketFunds = requiredPositive(row['min_market_funds']);
  // Refused, not defaulted: without the venue's own increments and minimum, a
  // simulated fill would be measured against numbers Coqui invented.
  if (baseIncrement === null || quoteIncrement === null || minMarketFunds === null) return null;

  const instrument: InstrumentIdentity = {
    venue: 'coinbase',
    productId: id,
    productType: 'spot',
  };

  return Object.freeze({
    id: sha256Hex(canonical(row)),
    instrument,
    status,
    tradingDisabled: rejectingBoolean(row['trading_disabled']),
    cancelOnly: rejectingBoolean(row['cancel_only']),
    limitOnly: rejectingBoolean(row['limit_only']),
    postOnly: rejectingBoolean(row['post_only']),
    // The Exchange endpoint has no view-only concept. Defaulting to true would
    // make every product unusable through the keyless path; the authenticated
    // enrichment may set it.
    viewOnly: false,
    baseIncrement,
    quoteIncrement,
    priceIncrement: quoteIncrement,
    baseMinSize: baseIncrement,
    baseMaxSize: null,
    quoteMinSize: minMarketFunds,
    quoteMaxSize: null,
    source: 'coinbase',
    retrievedAt: nowMs,
    responseHash: sha256Hex(canonical(row)),
  } satisfies ProductRuleSnapshot);
}

export interface CoinbaseProductRuleOptions {
  /** Injected so the adapter never reads the host clock. */
  readonly nowMs: number;
  readonly enrichment?: CoinbaseProductRuleEnrichment;
  readonly signal?: AbortSignal;
}

/**
 * Fetch venue rules for every Coinbase USD spot product.
 *
 * Unlike `fetchCoinbaseUniverseProducts`, a single unusable product does **not**
 * fail the batch — it is omitted. A venue that adds one malformed listing must
 * not stop paper trading on every other pair. A malformed *response* still
 * fails, because that is the venue disagreeing with its own contract.
 */
export async function fetchCoinbaseProductRules(
  http: HttpClient,
  options: CoinbaseProductRuleOptions,
): Promise<CoinbaseProductRuleResult> {
  const response = await http.getJson<unknown>(
    PRODUCTS_URL,
    options.signal ? { signal: options.signal } : undefined,
  );
  if (!response.ok) return { ok: false, code: failure(response) };
  if (!Array.isArray(response.data)) return { ok: false, code: 'invalid_response' };
  if (response.data.length > MAX_PRODUCTS) return { ok: false, code: 'response_too_large' };

  const rules: ProductRuleSnapshot[] = [];
  for (const value of response.data) {
    const parsed = parseProductRules(value, options.nowMs);
    if (parsed !== null) rules.push(parsed);
  }

  const enrichment = options.enrichment;
  if (enrichment === undefined) return { ok: true, rules: Object.freeze(rules) };

  const enriched = await Promise.all(
    rules.map(async (rule) => {
      let overlay: Awaited<ReturnType<CoinbaseProductRuleEnrichment['rules']>>;
      try {
        overlay = await enrichment.rules(rule.instrument);
      } catch {
        // The keyless base is still valid, so a failing overlay degrades to it
        // rather than losing the product.
        return rule;
      }
      if (overlay === null) return rule;
      const merged: ProductRuleSnapshot = Object.freeze({ ...rule, ...overlay });
      // An overlay that supplies an unusable increment is discarded, not trusted.
      return requiredPositive(merged.baseIncrement) === null ||
        requiredPositive(merged.quoteIncrement) === null ||
        requiredPositive(merged.quoteMinSize) === null
        ? rule
        : merged;
    }),
  );

  return { ok: true, rules: Object.freeze(enriched) };
}
