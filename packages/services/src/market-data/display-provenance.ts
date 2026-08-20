import type { ReferenceFailureCode } from '@coqui/adapters';

/**
 * Stable issue vocabulary for every display query.
 *
 * The renderer maps these to copy that explains the next safe action. A raw
 * provider error string must never reach a surface, so nothing outside this
 * union can be returned.
 */
export type DisplayQueryIssueCode =
  | 'invalid_instrument'
  | 'invalid_interval'
  | 'invalid_limit'
  | 'invalid_lookback'
  | 'clock_unavailable'
  | 'source_cancelled'
  | 'source_shutdown'
  | 'source_elapsed_budget_exhausted'
  | 'source_timeout'
  | 'source_network'
  | 'source_rate_limited'
  | 'source_http'
  | 'source_invalid_response'
  | 'source_response_too_large'
  | 'bars_unavailable'
  | 'bars_incomplete';

export interface DisplayQueryIssue {
  readonly path: readonly string[];
  readonly code: DisplayQueryIssueCode;
}

export type DisplayQueryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly DisplayQueryIssue[] };

export function displayFailure<T>(
  path: readonly string[],
  code: DisplayQueryIssueCode,
): DisplayQueryResult<T> {
  return { ok: false, issues: [{ path, code }] };
}

/** Translate an adapter failure into the display vocabulary without losing which one it was. */
export function sourceIssue(code: ReferenceFailureCode): DisplayQueryIssueCode {
  switch (code) {
    case 'cancelled':
      return 'source_cancelled';
    case 'shutdown':
      return 'source_shutdown';
    case 'elapsed_budget_exhausted':
      return 'source_elapsed_budget_exhausted';
    case 'timeout':
      return 'source_timeout';
    case 'network':
      return 'source_network';
    case 'rate_limited':
      return 'source_rate_limited';
    case 'invalid_response':
      return 'source_invalid_response';
    case 'response_too_large':
      return 'source_response_too_large';
    default:
      return 'source_http';
  }
}

/**
 * How old a reading is relative to the feed's own update cadence.
 *
 * `unknown` is a distinct outcome, not a synonym for fresh: several free feeds
 * publish no timestamp, and claiming freshness we cannot observe is the kind of
 * false confidence this project exists to avoid.
 */
export type ReferenceFreshness = 'fresh' | 'aging' | 'stale' | 'unknown';

/** Per-feed cadence policy. A feed that updates daily is not stale after a minute. */
export interface ReferenceFeedPolicy {
  /** Human-readable origin, e.g. `api.alternative.me`. Never a URL with query state. */
  readonly source: string;
  readonly agingAfterMs: number;
  readonly staleAfterMs: number;
}

/**
 * Provenance carried by every reference view.
 *
 * `informationalOnly` is a literal `true` rather than a boolean so a surface
 * cannot render reference data through a decision-grade component by accident —
 * the type will not permit it.
 */
export interface ReferenceProvenance {
  readonly source: string;
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  /** The provider's own publication time, when it supplies one. */
  readonly observedAtMs: number | null;
  /** Age at retrieval, derived from `observedAtMs`; null when unobservable. */
  readonly ageMs: number | null;
  readonly freshness: ReferenceFreshness;
  readonly informationalOnly: true;
  /** Restates the invariant at the data boundary: this never reaches a strategy. */
  readonly neverASignal: true;
}

/** Provenance for canonical Coinbase bars, which *are* decision-grade. */
export interface BarProvenance {
  readonly source: 'coinbase';
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly interval: '1d';
  readonly completedBarsOnly: true;
  readonly informationalOnly: false;
}

export function freshnessOf(
  ageMs: number | null,
  policy: ReferenceFeedPolicy,
): ReferenceFreshness {
  if (ageMs === null || ageMs < 0) return 'unknown';
  if (ageMs >= policy.staleAfterMs) return 'stale';
  if (ageMs >= policy.agingAfterMs) return 'aging';
  return 'fresh';
}

export function referenceProvenance(
  policy: ReferenceFeedPolicy,
  requestedAtMs: number,
  receivedAtMs: number,
  observedAtMs: number | null,
): ReferenceProvenance {
  const ageMs = observedAtMs === null ? null : receivedAtMs - observedAtMs;
  return {
    source: policy.source,
    requestedAtMs,
    receivedAtMs,
    observedAtMs,
    ageMs,
    freshness: freshnessOf(ageMs, policy),
    informationalOnly: true,
    neverASignal: true,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Cadence policies matched to each provider's documented publication rhythm.
 * The predecessor encoded these only as cache TTLs, which controlled how often
 * it refetched but told the user nothing about what they were looking at.
 */
export const FEED_POLICIES = {
  prices: { source: 'api.coingecko.com', agingAfterMs: 5 * MINUTE, staleAfterMs: 30 * MINUTE },
  markets: { source: 'api.coingecko.com', agingAfterMs: 5 * MINUTE, staleAfterMs: 30 * MINUTE },
  fearGreed: { source: 'api.alternative.me', agingAfterMs: 12 * HOUR, staleAfterMs: 36 * HOUR },
  trending: { source: 'api.coingecko.com', agingAfterMs: 15 * MINUTE, staleAfterMs: 2 * HOUR },
  yields: { source: 'yields.llama.fi', agingAfterMs: 6 * HOUR, staleAfterMs: 24 * HOUR },
  news: { source: 'rss + federalregister.gov', agingAfterMs: 2 * HOUR, staleAfterMs: 12 * HOUR },
} as const satisfies Record<string, ReferenceFeedPolicy>;
