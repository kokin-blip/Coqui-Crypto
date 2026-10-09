import { assertNewsObservation, isNewsTimestamp, type NewsAbortSignal, type NewsObservation,
  type NewsQuery } from '@coqui/core';
import type { NewsHttpTransport } from '../http/news.js';

export class NewsProviderError extends Error {
  constructor(readonly code: string, readonly requestCost = 0) { super(code); this.name = 'NewsProviderError'; }
}
export const invalidNewsResponse = (): never => { throw new NewsProviderError('invalid_response'); };
export function newsRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidNewsResponse();
  return value as Record<string, unknown>;
}
export function newsText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return invalidNewsResponse();
  return value.trim();
}
export function nullableNewsText(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : newsText(value);
}
export function newsTimestamp(value: unknown, compact = false): number | null {
  if (value === null || value === undefined || value === '') return null;
  let text = newsText(value);
  if (compact) {
    if (!/^\d{8}T\d{6}Z$/u.test(text)) return invalidNewsResponse();
    text = text.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u, '$1-$2-$3T$4:$5:$6Z');
  }
  // Explicit timezone is required; never interpret provider metadata in machine-local time.
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})? ?(?:Z|[+-]\d{2}:?\d{2})$/u.exec(text);
  if (!parts) return invalidNewsResponse();
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const calendar = new Date(Date.UTC(year, month - 1, day)); calendar.setUTCFullYear(year);
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day ||
    Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) return invalidNewsResponse();
  const time = Date.parse(text);
  if (!isNewsTimestamp(time) || (compact && new Date(time).toISOString().slice(0, 19) + 'Z' !== text)) return invalidNewsResponse();
  return time;
}
export function validNewsQuery(query: NewsQuery, now: number): void {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 250 ||
    (query.publishedAfterMs !== undefined && (!isNewsTimestamp(query.publishedAfterMs) || query.publishedAfterMs > now)) ||
    [query.keywords, query.symbols].some(values => values !== undefined &&
      (!Array.isArray(values) || values.length < 1 || values.length > 100 || values.some(value => typeof value !== 'string' ||
        value.trim().length === 0 || value.length > 256)))) throw new NewsProviderError('invalid_query');
}
export function safeNewsObservation(value: NewsObservation): NewsObservation {
  try {
    const url = new URL(value.url);
    if ([...url.searchParams.keys()].some(key => /^(?:api[_-]?(?:token|key)|access[_-]?token|authorization|token)$/iu.test(key))) {
      return invalidNewsResponse();
    }
    assertNewsObservation(value);
    return Object.freeze({ ...value, entities: Object.freeze(value.entities.map(entity => Object.freeze(entity))) });
  } catch { return invalidNewsResponse(); }
}
export function parseNewsResponse<T>(response: { readonly attempts: number }, parse: () => T): T {
  try { return parse(); }
  catch { throw new NewsProviderError('invalid_response', response.attempts); }
}
export async function requestNews(transport: NewsHttpTransport, url: string, signal?: NewsAbortSignal,
  headers?: Readonly<Record<string, string>>) {
  const controller = new AbortController(), abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await transport.request(url, { signal: controller.signal, ...(headers ? { headers } : {}) });
    if (!result.ok) {
      const code = result.status === 401 || result.status === 403 ? 'authentication_failed'
        : result.status === 402 || result.status === 429 ? 'rate_limited' : result.reason;
      throw new NewsProviderError(code, result.attempts);
    }
    return result;
  } catch (error) {
    if (error instanceof NewsProviderError) throw error;
    throw new NewsProviderError('network');
  } finally { signal?.removeEventListener('abort', abort); }
}
