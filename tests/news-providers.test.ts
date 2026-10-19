import { describe, expect, it, vi } from 'vitest';
import { createCurrentsNewsProvider, createGdeltNewsProvider, createMarketauxNewsProvider,
  createNewsHttpTransport, type FetchLike, type NewsHttpTransport } from '@coqui/adapters';
import { coveragePayload, currentsPayload, fixtureTransport, gdeltPayload, marketauxPayload,
  NEWS_NOW, newsPassThrough, newsResponse } from './fixtures/news/providers.js';
// The shared HTTP client imports Node timers; route them through the controlled test clock.
vi.mock('node:timers', async importOriginal => ({
  ...await importOriginal<typeof import('node:timers')>(),
  setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
}));
vi.mock('node:perf_hooks', async importOriginal => ({
  ...await importOriginal<typeof import('node:perf_hooks')>(),
  performance: { now: () => globalThis.performance.now() },
}));
const clock = { nowMs: () => NEWS_NOW };
const query = { keywords: ['Bitcoin'], limit: 100 };

describe('synthetic news provider adapters', () => {
  it('uses Marketaux query authentication, free limit and unresolved entity metadata', async () => {
    const request = vi.fn(fixtureTransport(marketauxPayload).request);
    const provider = createMarketauxNewsProvider({ token: 'synthetic-only-token', clock, transport: { request, destroy() {} } });
    const result = await provider.fetchLatest({ ...query, symbols: ['BTCUSD'] });
    const url = new URL(request.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe('https://api.marketaux.com/v1/news/all');
    expect(url.searchParams.get('limit')).toBe('3');
    expect(url.searchParams.get('api_token')).toBe('synthetic-only-token');
    expect(url.searchParams.get('symbols')).toBe('BTCUSD');
    expect(result.articles[0]?.entities[0]).toEqual({ symbol: 'BTCUSD', assetClass: 'crypto', providerEntityType: 'cryptocurrency', exchange: 'CCC', matchScore: 18.7, sentimentScore: 0.3 });
    expect(result.requestCost).toBe(1);
    expect(JSON.stringify(result)).not.toContain('synthetic-only-token');
  });
  it('uses Currents Bearer auth, v1 pagination, RFC3339 filters and nullable sentiment', async () => {
    const request = vi.fn(fixtureTransport(currentsPayload).request);
    const result = await createCurrentsNewsProvider({ key: 'synthetic-only-key', clock, transport: { request, destroy() {} } })
      .fetchLatest({ ...query, publishedAfterMs: NEWS_NOW - 86_400_000 });
    const url = new URL(request.mock.calls[0]![0]);
    expect(url.searchParams.get('page_size')).toBe('20');
    expect(url.searchParams.get('page_number')).toBe('1');
    expect(url.searchParams.get('start_date')).toBe('2026-10-07T12:00:00.000Z');
    expect(request.mock.calls[0]![1]?.headers).toEqual({ Authorization: 'Bearer synthetic-only-key' });
    expect(result.articles[0]).toMatchObject({ description: null, entities: [], publishedAtMs: NEWS_NOW - 3_600_000 });
  });
  it('rejects unsupported Currents symbol filters and spans over seven days before dispatch', async () => {
    const request = vi.fn(fixtureTransport(currentsPayload).request);
    const provider = createCurrentsNewsProvider({ key: 'synthetic-key', clock, transport: { request, destroy() {} } });
    await expect(provider.fetchLatest({ ...query, symbols: ['BTC'] })).rejects.toThrow('unsupported_symbols');
    await expect(provider.fetchLatest({ ...query, publishedAfterMs: NEWS_NOW - 8 * 86_400_000 })).rejects.toThrow('query_window_exceeded');
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps GDELT seen time separate from publication and raw coverage separate from articles', async () => {
    const request = vi.fn(fixtureTransport(gdeltPayload).request);
    const provider = createGdeltNewsProvider({ clock, transport: { request, destroy() {} } });
    const result = await provider.fetchLatest(query);
    expect(new URL(request.mock.calls[0]![0]).searchParams.get('mode')).toBe('artlist');
    expect(new URL(request.mock.calls[0]![0]).searchParams.get('query')).toBe('(Bitcoin)');
    expect(result.articles[0]).toMatchObject({ providerArticleId: null, publishedAtMs: null, providerObservedAtMs: NEWS_NOW - 3_600_000, observedAtMs: NEWS_NOW, entities: [] });
    request.mockImplementation(fixtureTransport(coveragePayload).request);
    const coverage = await provider.fetchCoverage(query);
    expect(new URL(request.mock.calls[1]![0]).searchParams.get('mode')).toBe('timelinevolraw');
    expect(coverage.points).toEqual([{ startTimeMs: NEWS_NOW - 3_600_000, articleCount: 12, totalArticleCount: 1000 }]);
  });
  it('uses HTTP only when explicitly selected and retains the protocol in immutable metadata', async () => {
    const request = vi.fn(fixtureTransport(gdeltPayload).request);
    const defaultProvider = createGdeltNewsProvider({ clock, transport: { request, destroy() {} } });
    expect((await defaultProvider.fetchLatest(query)).articles[0]).toMatchObject({ schemaVersion: 2, transportProtocol: 'https' });
    expect(new URL(request.mock.calls[0]![0]).protocol).toBe('https:');
    const optIn = createGdeltNewsProvider({ clock, transport: { request, destroy() {} }, transportProtocol: 'http' });
    expect((await optIn.fetchLatest(query)).articles[0]).toMatchObject({ schemaVersion: 2, transportProtocol: 'http' });
    expect(new URL(request.mock.calls[1]![0]).origin).toBe('http://api.gdeltproject.org');
    expect(() => createGdeltNewsProvider({ clock, transport: fixtureTransport(gdeltPayload), transportProtocol: 'ftp' as never })).toThrow('Invalid GDELT transport');
  });
  it('quotes phrases but leaves keywords bare and rejects query operators', async () => {
    const request = vi.fn(fixtureTransport(gdeltPayload).request);
    const provider = createGdeltNewsProvider({ clock, transport: { request, destroy() {} } });
    await provider.fetchLatest({ keywords: [' Bitcoin ', 'Federal Reserve', 'cryptocurrency'], limit: 100 });
    expect(new URL(request.mock.calls[0]![0]).searchParams.get('query'))
      .toBe('(Bitcoin OR "Federal Reserve" OR cryptocurrency)');
    for (const keyword of ['domain:example.com', '(Bitcoin)', '-Bitcoin', 'OR', '"Bitcoin"']) {
      await expect(provider.fetchLatest({ keywords: [keyword], limit: 100 })).rejects.toThrow('invalid_query');
    }
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...gdeltPayload, articles: [{ ...gdeltPayload.articles[0], seendate: '20260231T110000Z' }] },
    { ...gdeltPayload, articles: [{ ...gdeltPayload.articles[0], url: 'https://user:synthetic-secret@publisher.example' }] },
    { ...gdeltPayload, articles: [{ ...gdeltPayload.articles[0], url: 'https://publisher.example?api_token=synthetic-secret' }] },
    { articles: [{}] }, { error: 'synthetic-secret' },
  ])('fails closed on malformed or credential-bearing responses', async data => {
    const provider = createGdeltNewsProvider({ clock, transport: fixtureTransport(data) });
    await expect(provider.fetchLatest(query)).rejects.toThrow(/^invalid_response$/u);
  });
  it('sanitizes HTTP and thrown transport failures and detaches cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const request = vi.fn<NewsHttpTransport['request']>(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(true); throw new Error('https://api.example?api_token=synthetic-secret');
    });
    await expect(createMarketauxNewsProvider({ token: 'synthetic-secret', clock, transport: { request, destroy() {} } })
      .fetchLatest(query, controller.signal)).rejects.toThrow(/^network$/u);
    request.mockResolvedValue({ ok: false, status: 401, reason: 'http', retryAfterMs: null, attempts: 1 });
    await expect(createMarketauxNewsProvider({ token: 'synthetic-secret', clock, transport: { request, destroy() {} } })
      .fetchLatest(query)).rejects.toMatchObject({ code: 'authentication_failed', requestCost: 1 });
  });
});

describe('news transport uses one shared HTTP attempt', () => {
  it('does not silently retry and captures Retry-After without following redirects', async () => {
    const fetch = vi.fn<FetchLike>(async () => newsResponse({}, 503, { 'retry-after': '2' }));
    const transport = createNewsHttpTransport({ clock, fetch, rateLimiters: newsPassThrough });
    expect(await transport.request('https://api.marketaux.com/v1/news/all?api_token=synthetic-secret')).toMatchObject({ ok: false, status: 503, retryAfterMs: 2000, attempts: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
    transport.destroy();
    expect(await transport.request('https://api.example')).toMatchObject({ ok: false, reason: 'shutdown', attempts: 0 });
  });
  it('rejects oversized JSON and canceled requests without leaking request URLs', async () => {
    const fetch = vi.fn(async () => newsResponse({}, 200, { 'content-length': '4000001' }));
    const transport = createNewsHttpTransport({ clock, fetch, rateLimiters: newsPassThrough });
    expect(await transport.request('https://api.example?api_token=synthetic-secret')).toMatchObject({ ok: false });
    const controller = new AbortController(); controller.abort();
    const canceled = await transport.request('https://api.example', { signal: controller.signal });
    expect(canceled.ok).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(canceled)).not.toContain('synthetic-secret'); transport.destroy();
  });
});

describe('news response resource bounds', () => {
  it('times out an unresponsive fetch and cancels its wire signal', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetch: FetchLike = async (_url, init) => { signal = init?.signal; return await new Promise(() => {}); };
    const transport = createNewsHttpTransport({ clock, fetch, rateLimiters: newsPassThrough, timeoutMs: 10 });
    try {
      const pending = transport.request('https://api.example');
      await vi.advanceTimersByTimeAsync(10);
      expect(await pending).toMatchObject({ ok: false, reason: 'timeout', attempts: 1, diagnostic: { code: 'header_timeout', stage: 'headers', elapsedMs: 10 } });
      expect(signal?.aborted).toBe(true);
    } finally { transport.destroy(); vi.useRealTimers(); }
  });
  it('rejects oversized chunked responses before reading the remaining body', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4_000_001)); }, cancel() { canceled = true; } });
    const transport = createNewsHttpTransport({ clock, rateLimiters: newsPassThrough,
      fetch: async () => ({ ...newsResponse({}), body }) });
    expect(await transport.request('https://api.example')).toMatchObject({ ok: false, reason: 'parse', attempts: 1 });
    expect(canceled).toBe(true); transport.destroy();
  });
});

describe('safe news transport diagnostics', () => {
  it('distinguishes invalid JSON from HTTP failure without returning response text', async () => {
    const transport = createNewsHttpTransport({ clock, rateLimiters: newsPassThrough,
      fetch: async () => ({ ...newsResponse({}), text: async () => 'synthetic-secret upstream error' }) });
    const result = await transport.request('https://api.example?api_token=synthetic-secret');
    expect(result).toMatchObject({ ok: false, reason: 'parse', diagnostic: { code: 'invalid_json', stage: 'body' } });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    transport.destroy();
    const http = createNewsHttpTransport({ clock, rateLimiters: newsPassThrough, fetch: async () => newsResponse({}, 503) });
    expect(await http.request('https://api.example')).toMatchObject({ ok: false, diagnostic: { code: 'http_failure' } });
    http.destroy();
  });
  it.each([
    ['UND_ERR_CONNECT_TIMEOUT', 'connection_timeout'], ['ENOTFOUND', 'dns_failure'],
    ['CERT_HAS_EXPIRED', 'tls_failure'], ['ECONNREFUSED', 'connection_refused'],
    ['ECONNRESET', 'connection_reset'], ['ENETUNREACH', 'network_unreachable'],
    ['synthetic-secret', 'unknown'],
  ])('allowlists native network causes (%s) without exposing error details', async (nativeCode, expected) => {
    const transport = createNewsHttpTransport({ clock, rateLimiters: newsPassThrough,
      fetch: async () => { throw new Error('https://api.example?api_token=synthetic-secret',
        { cause: { code: nativeCode, address: 'synthetic-secret', message: 'synthetic-secret' } }); } });
    const result = await transport.request('https://api.example?api_token=synthetic-secret');
    expect(result).toMatchObject({ ok: false, reason: 'network', attempts: 1,
      diagnostic: { stage: 'headers', code: 'network', networkCode: expected } });
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    transport.destroy();
  });
  it('bounds a stalled body by the total deadline and aborts its wire signal', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const transport = createNewsHttpTransport({ clock, rateLimiters: newsPassThrough, timeoutMs: 10, maxElapsedMs: 35,
      fetch: async (_url, init) => { signal = init?.signal; return { ...newsResponse({}), text: async () => await new Promise(() => {}) }; } });
    try {
      const pending = transport.request('https://api.example');
      await vi.advanceTimersByTimeAsync(35);
      expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'body_timeout', elapsedMs: 35 } });
      expect(signal?.aborted).toBe(true);
    } finally { transport.destroy(); vi.useRealTimers(); }
  });
  it('aborts shutdown during a body read and returns a safe diagnostic', async () => {
    const transport = createNewsHttpTransport({ clock, rateLimiters: newsPassThrough,
      fetch: async () => ({ ...newsResponse({}), text: async () => await new Promise(() => {}) }) });
    const pending = transport.request('https://api.example?api_token=synthetic-secret');
    await new Promise(resolve => setTimeout(resolve, 0));
    transport.destroy();
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'shutdown' } });
  });
});
