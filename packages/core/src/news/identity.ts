import { sha256Hex } from '../crypto/sha256.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/decision.js';
import type { NewsObservation, NewsProviderId } from './types.js';

/** Portable platform declaration, like core's TextEncoder; no Node/DOM dependency. */
interface NewsUrl {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  hash: string;
  readonly searchParams: { keys(): IterableIterator<string>; delete(key: string): void; sort(): void };
  toString(): string;
}
declare const URL: { new (input: string): NewsUrl };

export const NEWS_NORMALIZATION_VERSION = 1 as const;

/** Conservative exact-link identity: publisher-specific parameters remain intact. */
export function canonicalNewsUrl(input: string): string {
  let url: NewsUrl;
  try { url = new URL(input); } catch { throw new TypeError('Invalid news article URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Invalid news article URL.');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith('utm_') || normalized === 'fbclid' || normalized === 'gclid') {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

export function newsUrlFingerprint(input: string): string {
  return sha256Hex(canonicalNewsUrl(input));
}

export function newsProviderRecordKey(providerArticleId: string | null, urlHash: string): string {
  return providerArticleId === null ? `url:${urlHash}` : `id:${providerArticleId}`;
}

export function newsProviderRecordId(provider: NewsProviderId, recordKey: string): string {
  return sha256Hex(JSON.stringify(['news-provider-record-v1', provider, recordKey]));
}

/** Receipt times are excluded so refetching the same content is idempotent. */
export function newsContentJson(observation: NewsObservation): string {
  const metadata = {
    schemaVersion: observation.schemaVersion, provider: observation.provider,
    providerArticleId: observation.providerArticleId, title: observation.title,
    url: observation.url, sourceDomain: observation.sourceDomain, description: observation.description,
    publishedAtMs: observation.publishedAtMs, providerObservedAtMs: observation.providerObservedAtMs,
    language: observation.language, entities: observation.entities,
    ...(observation.schemaVersion === 2 ? { transportProtocol: observation.transportProtocol } : {}),
  };
  return canonicalJson(metadata as unknown as CanonicalJsonValue);
}

export function newsContentHash(observation: NewsObservation): string {
  return sha256Hex(newsContentJson(observation));
}

export function newsObservationId(providerRecordId: string, contentHash: string): string {
  return sha256Hex(JSON.stringify(['news-observation-v1', providerRecordId, contentHash]));
}
