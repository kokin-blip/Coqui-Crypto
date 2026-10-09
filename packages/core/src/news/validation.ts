import { canonicalNewsUrl } from './identity.js';
import type { NewsObservation } from './types.js';

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function isNewsTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nullableText(value: unknown, max: number): boolean {
  return value === null || text(value, max);
}

/** Repository guard: no casts or extra payload fields can bypass the storage boundary. */
export function assertNewsObservation(value: unknown): asserts value is NewsObservation {
  const invalid = () => { throw new TypeError('Invalid news observation.'); };
  if (!record(value, ['schemaVersion', 'provider', 'providerArticleId', 'title', 'url',
    'sourceDomain', 'description', 'publishedAtMs', 'providerObservedAtMs', 'observedAtMs',
    'language', 'entities'])) return invalid();
  if (value['schemaVersion'] !== 1 || typeof value['provider'] !== 'string' ||
    !['marketaux', 'currents', 'gdelt'].includes(value['provider']) ||
    !nullableText(value['providerArticleId'], 256) || !text(value['title'], 1_000) ||
    !text(value['url'], 4_096) || !text(value['sourceDomain'], 253) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/iu.test(value['sourceDomain']) ||
    !nullableText(value['description'], 8_000) || !nullableText(value['language'], 64) ||
    !isNewsTimestamp(value['observedAtMs']) ||
    !(value['publishedAtMs'] === null || isNewsTimestamp(value['publishedAtMs'])) ||
    !(value['providerObservedAtMs'] === null || isNewsTimestamp(value['providerObservedAtMs'])) ||
    !Array.isArray(value['entities']) || value['entities'].length > 100) return invalid();
  try { canonicalNewsUrl(value['url']); } catch { return invalid(); }
  for (const entity of value['entities']) {
    if (!record(entity, ['symbol', 'assetClass', 'providerEntityType', 'exchange', 'matchScore', 'sentimentScore']) ||
      !text(entity['symbol'], 128) || typeof entity['assetClass'] !== 'string' ||
      !['crypto', 'equity', 'unknown'].includes(entity['assetClass']) ||
      !nullableText(entity['providerEntityType'], 128) || !nullableText(entity['exchange'], 128) ||
      !(entity['matchScore'] === null || (typeof entity['matchScore'] === 'number' && Number.isFinite(entity['matchScore']))) ||
      !(entity['sentimentScore'] === null || (typeof entity['sentimentScore'] === 'number' &&
        Number.isFinite(entity['sentimentScore']) && Math.abs(entity['sentimentScore']) <= 1))) return invalid();
  }
}
