import type { NewsObservation } from '@coqui/core';

/** Entirely synthetic metadata; no provider credentials or copyrighted article bodies. */
export function newsFixture(overrides: Partial<NewsObservation> = {}): NewsObservation {
  return {
    schemaVersion: 1, provider: 'marketaux', providerArticleId: 'synthetic-article-1',
    title: 'Synthetic protocol announcement', url: 'https://publisher.example/story?utm_source=fixture',
    sourceDomain: 'publisher.example', description: null, publishedAtMs: 100,
    providerObservedAtMs: null, observedAtMs: 200, language: 'en',
    entities: [{ symbol: 'BTC', assetClass: 'unknown', providerEntityType: null,
      exchange: null, matchScore: 12.133104, sentimentScore: null }],
    ...overrides,
  };
}
