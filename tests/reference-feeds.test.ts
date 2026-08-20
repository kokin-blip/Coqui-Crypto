import { describe, expect, it } from 'vitest';

import {
  classifyFearGreed,
  fetchFearGreed,
  fetchNewsHeadlines,
  fetchPolicyItems,
  fetchTrendingCoins,
  fetchYields,
  matchPolicyKeywords,
  parseRssItems,
  type HttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';

interface Route {
  readonly json?: unknown;
  readonly text?: string;
  readonly failure?: { readonly status: number; readonly reason: 'timeout' | 'network' | 'http' | 'parse' };
}

/** Route-driven client so each test states only the responses it cares about. */
function client(routes: Record<string, Route>, calls: string[] = []): HttpClient {
  function respond<T>(url: string, pick: (route: Route) => T | undefined): HttpResult<T> {
    calls.push(url);
    const key = Object.keys(routes).find((candidate) => url.includes(candidate));
    const route = key === undefined ? undefined : routes[key];
    if (route === undefined) return { ok: false, status: 404, reason: 'http', retried: 0 };
    if (route.failure) {
      return { ok: false, status: route.failure.status, reason: route.failure.reason, retried: 0 };
    }
    const value = pick(route);
    if (value === undefined) return { ok: false, status: 404, reason: 'http', retried: 0 };
    return { ok: true, data: value, status: 200 };
  }

  return {
    async getJson<T>(url: string): Promise<HttpResult<T>> {
      return respond(url, (route) => route.json as T | undefined);
    },
    async postJson<T>(): Promise<HttpResult<T>> {
      return { ok: false, status: 405, reason: 'http', retried: 0 };
    },
    async getText(url: string): Promise<HttpResult<string>> {
      return respond(url, (route) => route.text);
    },
    destroy() {},
  };
}

describe('fear & greed adapter', () => {
  it('reads the reading and the provider publication time', async () => {
    const http = client({
      'api.alternative.me': {
        json: { data: [{ value: '31', value_classification: 'Fear', timestamp: '1723334400' }] },
      },
    });
    const result = await fetchFearGreed(http);
    expect(result).toEqual({
      ok: true,
      value: { value: 31, classification: 'Fear' },
      observedAtMs: 1_723_334_400_000,
    });
  });

  it('falls back to the published bands only when the source omits a label', async () => {
    const http = client({ 'api.alternative.me': { json: { data: [{ value: '80' }] } } });
    const result = await fetchFearGreed(http);
    expect(result.ok && result.value.classification).toBe('Extreme Greed');
    expect(result.ok && result.observedAtMs).toBeNull();
    expect(classifyFearGreed(24)).toBe('Extreme Fear');
    expect(classifyFearGreed(54)).toBe('Neutral');
  });

  it('names the failure instead of degrading to null', async () => {
    const timeout = await fetchFearGreed(
      client({ 'api.alternative.me': { failure: { status: 0, reason: 'timeout' } } }),
    );
    expect(timeout).toEqual({ ok: false, code: 'timeout' });

    const malformed = await fetchFearGreed(client({ 'api.alternative.me': { json: { data: [] } } }));
    expect(malformed).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('rejects an out-of-range index rather than displaying it', async () => {
    const http = client({ 'api.alternative.me': { json: { data: [{ value: '140' }] } } });
    expect(await fetchFearGreed(http)).toEqual({ ok: false, code: 'invalid_response' });
  });
});

describe('yields adapter', () => {
  const pools = {
    data: [
      { symbol: 'SOL', apy: 7.1, tvlUsd: 40_000_000, project: 'kamino-lend', chain: 'Solana' },
      { symbol: 'SOL', apy: 9.4, tvlUsd: 12_000_000, project: 'marinade', chain: 'Solana' },
      { symbol: 'ETH', apy: 3.2, tvlUsd: 900_000, project: 'thin-pool', chain: 'Ethereum' },
      { symbol: 'USDC-USDT', apy: 22, tvlUsd: 50_000_000, project: 'lp-pair', chain: 'Ethereum' },
      { symbol: 'BTC', apy: 0, tvlUsd: 90_000_000, project: 'zero', chain: 'Bitcoin' },
    ],
  };

  it('keeps the best single-asset pool above the TVL floor', async () => {
    const result = await fetchYields(client({ 'yields.llama.fi': { json: pools } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.keys()]).toEqual(['SOL']);
    expect(result.value.get('SOL')).toEqual({
      symbol: 'SOL',
      apyPct: 9.4,
      project: 'marinade',
      chain: 'Solana',
      tvlUsd: 12_000_000,
    });
  });

  it('reports no observation time because the feed publishes none', async () => {
    const result = await fetchYields(client({ 'yields.llama.fi': { json: pools } }));
    expect(result.ok && result.observedAtMs).toBeNull();
  });

  it('names a transport failure', async () => {
    const result = await fetchYields(
      client({ 'yields.llama.fi': { failure: { status: 429, reason: 'http' } } }),
    );
    expect(result).toEqual({ ok: false, code: 'rate_limited' });
  });
});

describe('trending adapter', () => {
  it('normalises entries and drops duplicates and malformed rows', async () => {
    const http = client({
      'search/trending': {
        json: {
          coins: [
            { item: { id: 'solana', symbol: 'sol', name: 'Solana', market_cap_rank: 5, thumb: 'https://x/y.png' } },
            { item: { id: 'solana', symbol: 'sol', name: 'Solana' } },
            { item: { id: 'broken', symbol: 'ok' } },
            { item: { id: 'insecure', symbol: 'ins', name: 'Insecure', thumb: 'http://x/y.png' } },
          ],
        },
      },
    });
    const result = await fetchTrendingCoins(http);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { coingeckoId: 'solana', symbol: 'SOL', name: 'Solana', marketCapRank: 5, thumbnailUrl: 'https://x/y.png' },
      { coingeckoId: 'insecure', symbol: 'INS', name: 'Insecure', marketCapRank: null, thumbnailUrl: null },
    ]);
  });
});

describe('news adapter', () => {
  const rss = (title: string, url: string, date: string): string =>
    `<rss><channel><item><title><![CDATA[${title}]]></title><link>${url}</link>` +
    `<pubDate>${date}</pubDate></item></channel></rss>`;

  it('parses RSS and Atom shapes and rejects non-HTTPS links', () => {
    const atom =
      '<feed><entry><title>Atom &amp; Co</title><link href="https://a/1"/>' +
      '<published>2026-08-01T00:00:00Z</published></entry>' +
      '<entry><title>Insecure</title><link href="http://a/2"/></entry></feed>';
    const items = parseRssItems(atom, 'Test');
    expect(items).toEqual([
      { title: 'Atom & Co', url: 'https://a/1', source: 'Test', publishedAtMs: Date.parse('2026-08-01T00:00:00Z') },
    ]);
  });

  it('merges feeds, dedupes by URL, and orders newest first', async () => {
    const http = client({
      'coindesk.com': { text: rss('Older', 'https://n/1', 'Mon, 01 Jan 2026 00:00:00 GMT') },
      'cointelegraph.com': { text: rss('Newer', 'https://n/2', 'Fri, 01 May 2026 00:00:00 GMT') },
      'decrypt.co': { text: rss('Duplicate', 'https://n/1', 'Mon, 01 Jan 2026 00:00:00 GMT') },
    });
    const result = await fetchNewsHeadlines(http, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.title)).toEqual(['Newer', 'Older']);
  });

  it('survives one broken publisher but fails when every feed fails', async () => {
    const partial = await fetchNewsHeadlines(
      client({
        'coindesk.com': { failure: { status: 500, reason: 'http' } },
        'cointelegraph.com': { text: rss('Alive', 'https://n/3', 'Fri, 01 May 2026 00:00:00 GMT') },
        'decrypt.co': { failure: { status: 0, reason: 'network' } },
      }),
      10,
    );
    expect(partial.ok && partial.value).toHaveLength(1);

    const total = await fetchNewsHeadlines(
      client({
        'coindesk.com': { failure: { status: 0, reason: 'network' } },
        'cointelegraph.com': { failure: { status: 0, reason: 'network' } },
        'decrypt.co': { failure: { status: 0, reason: 'network' } },
      }),
      10,
    );
    expect(total).toEqual({ ok: false, code: 'network' });
  });

  it('requires the policy keyword to appear in the title, not the body', async () => {
    expect(matchPolicyKeywords('SEC approves a stablecoin rule')).toEqual(['stablecoin']);
    expect(matchPolicyKeywords('Visa processing update')).toEqual([]);

    const http = client({
      'federalregister.gov': {
        json: {
          results: [
            { title: 'Digital asset reporting rule', html_url: 'https://fr/1', publication_date: '2026-08-01', type: 'Rule' },
            { title: 'Unrelated aviation notice', html_url: 'https://fr/2', publication_date: '2026-08-02' },
          ],
        },
      },
      'sec.gov': { text: rss('SEC charges crypto firm', 'https://sec/1', 'Sat, 02 Aug 2026 00:00:00 GMT') },
    });
    const result = await fetchPolicyItems(http, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((item) => item.title)).toEqual([
      'SEC charges crypto firm',
      '[Rule] Digital asset reporting rule',
    ]);
    expect(result.value[1]?.matched).toEqual(['digital asset']);
  });
});
