import type { Clock, NewsEntity, NewsProvider } from '@coqui/core';
import type { NewsHttpTransport } from '../http/news.js';
import { invalidNewsResponse, newsRecord, newsText, newsTimestamp, nullableNewsText,
  parseNewsResponse, requestNews, safeNewsObservation, validNewsQuery } from './common.js';

export function createMarketauxNewsProvider(input: { readonly transport: NewsHttpTransport;
  readonly token: string; readonly clock: Clock }): NewsProvider {
  if (!input.token.trim() || /\s/u.test(input.token) || input.token.length > 4_096) throw new Error('invalid_credentials');
  return { id: 'marketaux', async fetchLatest(query, signal) {
    validNewsQuery(query, input.clock.nowMs());
    const limit = Math.min(3, query.limit), url = new URL('https://api.marketaux.com/v1/news/all');
    url.searchParams.set('api_token', input.token);
    url.searchParams.set('limit', String(limit)); url.searchParams.set('language', 'en');
    url.searchParams.set('group_similar', 'false');
    if (query.symbols) { url.searchParams.set('symbols', query.symbols.join(',')); url.searchParams.set('filter_entities', 'true'); }
    if (query.keywords) url.searchParams.set('search', query.keywords.map(term => `"${term.replaceAll('"', '\\"')}"`).join('|'));
    if (query.publishedAfterMs !== undefined) url.searchParams.set('published_after', new Date(query.publishedAfterMs).toISOString().slice(0, 19));
    const response = await requestNews(input.transport, url.toString(), signal);
    return parseNewsResponse(response, () => {
      const body = newsRecord(response.data);
      if (!Array.isArray(body['data']) || body['data'].length > 3 || body['error'] !== undefined) return invalidNewsResponse();
      const articles = body['data'].slice(0, limit).map(raw => {
        const article = newsRecord(raw);
        if (article['entities'] !== undefined && (!Array.isArray(article['entities']) || article['entities'].length > 100)) return invalidNewsResponse();
        const entities: NewsEntity[] = (article['entities'] as unknown[] | undefined ?? []).map(rawEntity => {
          const entity = newsRecord(rawEntity), type = nullableNewsText(entity['type']);
          return { symbol: newsText(entity['symbol']), assetClass: type === 'cryptocurrency' ? 'crypto' : type === 'equity' ? 'equity' : 'unknown',
            providerEntityType: type, exchange: nullableNewsText(entity['exchange']),
            matchScore: entity['match_score'] === undefined ? null : entity['match_score'] as number | null,
            sentimentScore: entity['sentiment_score'] === undefined ? null : entity['sentiment_score'] as number | null };
        });
        return safeNewsObservation({ schemaVersion: 1, provider: 'marketaux', providerArticleId: newsText(article['uuid']),
          title: newsText(article['title']), url: newsText(article['url']), sourceDomain: newsText(article['source']),
          description: nullableNewsText(article['description']), language: nullableNewsText(article['language']),
          publishedAtMs: newsTimestamp(article['published_at']), providerObservedAtMs: null,
          observedAtMs: response.receivedAtMs, entities });
    });
    return { articles: Object.freeze(articles), requestCost: response.attempts };
    });
  } };
}
