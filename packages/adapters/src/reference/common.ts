import type { HttpFailure } from '../http/index.js';

/**
 * Stable failure vocabulary shared by every keyless reference feed.
 *
 * The predecessor degraded each of these feeds to `null`, `[]`, or `{}` on any
 * error, which made "the provider is down", "the payload was malformed", and
 * "there is genuinely nothing to report" indistinguishable at the UI. Coqui
 * names the failure instead so a surface can say which one happened.
 */
export type ReferenceFailureCode =
  | 'cancelled'
  | 'shutdown'
  | 'elapsed_budget_exhausted'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'http'
  | 'invalid_response'
  | 'response_too_large';

export type ReferenceResult<T> =
  | { readonly ok: true; readonly value: T; readonly observedAtMs: number | null }
  | { readonly ok: false; readonly code: ReferenceFailureCode };

/** Map a transport failure onto the stable vocabulary above. */
export function referenceFailure(value: HttpFailure): ReferenceFailureCode {
  if (value.reason === 'canceled') return 'cancelled';
  if (value.reason === 'shutdown') return 'shutdown';
  if (value.reason === 'elapsed-budget') return 'elapsed_budget_exhausted';
  if (value.reason === 'timeout') return 'timeout';
  if (value.reason === 'parse' || value.reason === 'serialize') return 'invalid_response';
  if (value.status === 0) return 'network';
  if (value.status === 429) return 'rate_limited';
  return 'http';
}

export function referenceRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse a provider publication time without letting a bad value become "now". */
export function publicationTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds > 0 && !trimmed.includes('-')) {
    return Math.round(seconds * 1000);
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
