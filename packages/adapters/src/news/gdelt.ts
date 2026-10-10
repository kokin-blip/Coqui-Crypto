import type { Clock, NewsAbortSignal, NewsProvider, NewsQuery } from '@coqui/core';
import type { NewsHttpTransport } from '../http/news.js';
import { invalidNewsResponse, NewsProviderError, newsRecord, newsText, newsTimestamp, nullableNewsText,
  parseNewsResponse, requestNews, safeNewsObservation, validNewsQuery } from './common.js';

export interface GdeltCoverageResult {
  readonly provider: 'gdelt'; readonly observedAtMs: number; readonly requestCost: number;
  readonly points: readonly { readonly startTimeMs: number; readonly articleCount: number; readonly totalArticleCount: number }[];
}
export interface GdeltNewsProvider extends NewsProvider {
  fetchCoverage(query: NewsQuery, signal?: NewsAbortSignal): Promise<GdeltCoverageResult>;
}
export function createGdeltNewsProvider(input: { readonly transport: NewsHttpTransport; readonly clock: Clock; readonly transportProtocol?: 'https' | 'http' }): GdeltNewsProvider {
  const transportProtocol = input.transportProtocol ?? 'https';
  if (!['https', 'http'].includes(transportProtocol)) throw new TypeError('Invalid GDELT transport protocol.');
  function urlFor(query: NewsQuery, mode: string): string {
    const now = input.clock.nowMs(); validNewsQuery(query, now);
    if (query.symbols !== undefined) throw new NewsProviderError('unsupported_symbols');
    if (!query.keywords?.length || query.keywords.some(term => /["\\():]/u.test(term) || /^[-+]|^(?:OR|AND|NOT)$/u.test(term.trim()))) throw new NewsProviderError('invalid_query');
    const url = new URL(`${transportProtocol}://api.gdeltproject.org/api/v2/doc/doc`);
    url.searchParams.set('query', `(${query.keywords.map(term => /\s/u.test(term.trim()) ? `"${term.trim()}"` : term.trim()).join(' OR ')})`);
    url.searchParams.set('mode', mode); url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', String(query.limit)); url.searchParams.set('sort', 'datedesc');
    if (query.publishedAfterMs === undefined) url.searchParams.set('timespan', '1day');
    else { const compact = (ms: number) => new Date(ms).toISOString().replaceAll(/[-:TZ.]/gu, '').slice(0, 14);
      url.searchParams.set('startdatetime', compact(query.publishedAfterMs)); url.searchParams.set('enddatetime', compact(now)); }
    return url.toString();
  }
  return { id: 'gdelt', async fetchLatest(query, signal) {
    const response = await requestNews(input.transport, urlFor(query, 'artlist'), signal);
    return parseNewsResponse(response, () => {
      const body = newsRecord(response.data);
      if (!Array.isArray(body['articles']) || body['articles'].length > 250) return invalidNewsResponse();
      const articles = body['articles'].slice(0, query.limit).map(raw => {
        const article = newsRecord(raw);
        return safeNewsObservation({ schemaVersion: 2, transportProtocol, provider: 'gdelt', providerArticleId: null,
          title: newsText(article['title']), url: newsText(article['url']), sourceDomain: newsText(article['domain']),
          description: null, language: nullableNewsText(article['language']), publishedAtMs: null,
          providerObservedAtMs: newsTimestamp(article['seendate'], true), observedAtMs: response.receivedAtMs, entities: [] });
    });
    return { articles: Object.freeze(articles), requestCost: response.attempts };
    });
  }, async fetchCoverage(query, signal) {
    const response = await requestNews(input.transport, urlFor(query, 'timelinevolraw'), signal);
    return parseNewsResponse(response, () => {
      const body = newsRecord(response.data);
      if (!Array.isArray(body['timeline']) || body['timeline'].length > 1) return invalidNewsResponse();
      const series = body['timeline'].length ? newsRecord(body['timeline'][0]) : { data: [] };
      if (!Array.isArray(series['data']) || series['data'].length > 2_000) return invalidNewsResponse();
      const points = series['data'].map(raw => {
        const point = newsRecord(raw), startTimeMs = newsTimestamp(point['date'], true);
        const articleCount = point['value'], totalArticleCount = point['norm'];
        if (startTimeMs === null || typeof articleCount !== 'number' || typeof totalArticleCount !== 'number' ||
          !Number.isSafeInteger(articleCount) || !Number.isSafeInteger(totalArticleCount) || articleCount < 0 || totalArticleCount < articleCount) return invalidNewsResponse();
        return Object.freeze({ startTimeMs, articleCount, totalArticleCount });
    });
    return { provider: 'gdelt', observedAtMs: response.receivedAtMs, requestCost: response.attempts, points: Object.freeze(points) };
    });
  } };
}
