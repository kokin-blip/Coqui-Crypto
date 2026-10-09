import type { Clock, NewsProvider } from '@coqui/core';
import type { NewsHttpTransport } from '../http/news.js';
import { invalidNewsResponse, NewsProviderError, newsRecord, newsText, newsTimestamp, nullableNewsText,
  parseNewsResponse, requestNews, safeNewsObservation, validNewsQuery } from './common.js';

export function createCurrentsNewsProvider(input: { readonly transport: NewsHttpTransport;
  readonly key: string; readonly clock: Clock }): NewsProvider {
  if (!input.key.trim() || /\s/u.test(input.key) || input.key.length > 4_096) throw new Error('invalid_credentials');
  return { id: 'currents', async fetchLatest(query, signal) {
    const now = input.clock.nowMs(); validNewsQuery(query, now);
    if (query.symbols !== undefined) throw new NewsProviderError('unsupported_symbols');
    if (query.publishedAfterMs !== undefined && now - query.publishedAfterMs > 7 * 86_400_000) throw new NewsProviderError('query_window_exceeded');
    const limit = Math.min(20, query.limit), url = new URL('https://api.currentsapi.services/v1/search');
    url.searchParams.set('page_size', String(limit)); url.searchParams.set('page_number', '1'); url.searchParams.set('language', 'en');
    if (query.keywords) url.searchParams.set('keywords', query.keywords.join(' '));
    if (query.publishedAfterMs !== undefined) { url.searchParams.set('start_date', new Date(query.publishedAfterMs).toISOString()); url.searchParams.set('end_date', new Date(now).toISOString()); }
    const response = await requestNews(input.transport, url.toString(), signal, { Authorization: `Bearer ${input.key}` });
    return parseNewsResponse(response, () => {
      const body = newsRecord(response.data);
      if (body['status'] !== 'ok' || !Array.isArray(body['news']) || body['news'].length > 20) return invalidNewsResponse();
      const articles = body['news'].slice(0, limit).map(raw => {
        const article = newsRecord(raw), articleUrl = newsText(article['url']);
        let domain: string; try { domain = new URL(articleUrl).hostname; } catch { return invalidNewsResponse(); }
        return safeNewsObservation({ schemaVersion: 1, provider: 'currents', providerArticleId: newsText(article['id']),
          title: newsText(article['title']), url: articleUrl, sourceDomain: domain,
          description: nullableNewsText(article['description']), language: nullableNewsText(article['language']),
          publishedAtMs: newsTimestamp(article['published']), providerObservedAtMs: null, observedAtMs: response.receivedAtMs, entities: [] });
    });
    return { articles: Object.freeze(articles), requestCost: response.attempts };
    });
  } };
}
