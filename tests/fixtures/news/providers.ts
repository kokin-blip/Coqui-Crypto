import type { FetchLikeResponse, NewsHttpTransport, RateLimiterRegistry } from '@coqui/adapters';
export const NEWS_NOW = Date.parse('2026-10-08T12:00:00Z');
export const marketauxPayload = { data: [{ uuid: 'synthetic-ma-1', title: 'Synthetic Bitcoin policy headline',
  url: 'https://publisher.example/story?utm_source=test', source: 'publisher.example', published_at: '2026-10-08T11:00:00Z',
  entities: [{ symbol: 'BTCUSD', type: 'cryptocurrency', exchange: 'CCC', match_score: 18.7, sentiment_score: 0.3 }] }] };
export const currentsPayload = { status: 'ok', news: [{ id: 'synthetic-cu-1', title: 'Synthetic Bitcoin policy headline',
  url: 'https://publisher.example/story', published: '2026-10-08 11:00:00 +0000' }] };
export const gdeltPayload = { articles: [{ title: 'Synthetic Bitcoin policy headline', url: 'https://publisher.example/story',
  domain: 'publisher.example', seendate: '20261008T110000Z', language: 'English' }] };
export const coveragePayload = { timeline: [{ series: 'Volume Intensity', data: [{ date: '20261008T110000Z', value: 12, norm: 1000 }] }] };
export function newsResponse(data: unknown, status = 200, headers: Record<string, string> = {}): FetchLikeResponse {
  const text = JSON.stringify(data);
  return { ok: status >= 200 && status < 300, status, headers: { get: name => headers[name.toLowerCase()] ?? null },
    json: async () => data, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
}
export const newsPassThrough: RateLimiterRegistry = { forDomain: () => ({ acquire: async () => 'acquired',
  available: () => 1, pending: () => 0, destroy() {} }), destroyAll() {} };
export function fixtureTransport(data: unknown): NewsHttpTransport {
  return { request: async () => ({ ok: true, data, receivedAtMs: NEWS_NOW, attempts: 1 }), destroy() {} };
}
