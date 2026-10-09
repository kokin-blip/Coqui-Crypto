import { describe, expect, expectTypeOf, it } from 'vitest';

import { newsEntitySchema, newsFetchResultSchema, newsObservationSchema, newsQuerySchema } from '@coqui/contracts';
import { assertNewsObservation, canonicalNewsUrl, newsContentHash, newsUrlFingerprint,
  type NewsEntity, type NewsFetchResult, type NewsObservation, type NewsProvider, type NewsQuery } from '@coqui/core';
import { newsFixture } from './fixtures/news/observations.js';

describe('news contracts and conservative exact identity', () => {
  it('keeps domain types compatible with runtime schemas and provider interfaces', async () => {
    expectTypeOf<ReturnType<typeof newsEntitySchema.parse>>().toEqualTypeOf<NewsEntity>();
    expectTypeOf<ReturnType<typeof newsObservationSchema.parse>>().toEqualTypeOf<NewsObservation>();
    expectTypeOf<ReturnType<typeof newsQuerySchema.parse>>().toEqualTypeOf<NewsQuery>();
    expectTypeOf<ReturnType<typeof newsFetchResultSchema.parse>>().toEqualTypeOf<NewsFetchResult>();
    const provider: NewsProvider = { id: 'gdelt', async fetchLatest() {
      return { articles: [newsFixture({ provider: 'gdelt' })], requestCost: 1 };
    } };
    expect(newsFetchResultSchema.safeParse(await provider.fetchLatest({ limit: 3 }, new AbortController().signal)).success).toBe(true);
    expect(newsQuerySchema.safeParse({ limit: 3, publishedAfterMs: 0, symbols: ['BTC'] }).success).toBe(true);
    expect(newsQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(newsFetchResultSchema.safeParse({ articles: [], requestCost: -1 }).success).toBe(false);
  });

  it('accepts raw match scores above one, null sentiment and independent timestamps', () => {
    const value = newsFixture({ publishedAtMs: 300, providerObservedAtMs: 250 });
    expect(newsObservationSchema.parse(value)).toEqual(value);
    expect(() => assertNewsObservation(value)).not.toThrow();
    expect(newsObservationSchema.parse(value).entities[0]?.matchScore).toBeGreaterThan(1);
    const missing = newsFixture({ publishedAtMs: null, providerObservedAtMs: null,
      language: null, providerArticleId: null, entities: [] });
    expect(newsObservationSchema.parse(missing)).toEqual(missing);
    expect(() => assertNewsObservation(missing)).not.toThrow();
  });

  it.each([
    { title: ' ' }, { title: 'x'.repeat(1_001) }, { provider: 'unsupported' }, { schemaVersion: 2 },
    { observedAtMs: -1 }, { observedAtMs: Number.MAX_SAFE_INTEGER + 1 }, { publishedAtMs: NaN },
    { providerObservedAtMs: Infinity }, { publishedAtMs: 0.5 },
    { url: 'file:///article' }, { url: 'https://user:password@publisher.example/story' },
    { sourceDomain: 'https://publisher.example' }, { entities: Array.from({ length: 101 }, () => newsFixture().entities[0]) },
    { description: 'x'.repeat(8_001) }, { providerArticleId: '' }, { authorization: 'synthetic-secret' },
    { entities: [{ ...newsFixture().entities[0], sentimentScore: 1.01 }] },
    { entities: [{ ...newsFixture().entities[0], matchScore: Infinity }] },
    { entities: [{ ...newsFixture().entities[0], headers: {} }] },
  ])('rejects invalid or non-allowlisted metadata: %j', overrides => {
    const value = { ...newsFixture(), ...overrides };
    expect(newsObservationSchema.safeParse(value).success).toBe(false);
    expect(() => assertNewsObservation(value)).toThrow('Invalid news observation');
  });

  it('merges tracking variants and sorts queries without changing publisher identity', () => {
    expect(canonicalNewsUrl('https://Publisher.example/Story/?z=2&utm_source=x&a=1#section'))
      .toBe('https://publisher.example/Story/?a=1&z=2');
    expect(newsUrlFingerprint('https://publisher.example/story?fbclid=x&gclid=y&UTM_source=z'))
      .toBe(newsUrlFingerprint('https://publisher.example/story'));
    for (const url of ['http://publisher.example/story', 'https://www.publisher.example/story',
      'https://publisher.example/Story', 'https://publisher.example/story/',
      'https://publisher.example/story?ref=1', 'https://publisher.example/story?source=1',
      'https://publisher.example/story?id=1']) {
      expect(newsUrlFingerprint(url)).not.toBe(newsUrlFingerprint('https://publisher.example/story'));
    }
    expect(newsUrlFingerprint('https://publisher.example/story')).toMatch(/^[a-f0-9]{64}$/u);
    expect(newsContentHash(newsFixture({ observedAtMs: 999 }))).toBe(newsContentHash(newsFixture()));
    expect(newsContentHash(newsFixture({ title: 'Correction' }))).not.toBe(newsContentHash(newsFixture()));
    expect(() => canonicalNewsUrl('invalid-url-containing-synthetic-secret'))
      .toThrow(/^Invalid news article URL\.$/u);
  });
});
