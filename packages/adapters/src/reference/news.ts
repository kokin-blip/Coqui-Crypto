import type { HttpClient } from '../http/index.js';
import {
  publicationTime,
  referenceFailure,
  referenceRecord,
  type ReferenceFailureCode,
  type ReferenceResult,
} from './common.js';

/**
 * Free news and policy layer — awareness, never signal.
 *
 * Ported from the predecessor's `src/core/market/news.ts`, whose reasoning is
 * preserved: news has no clean historical archive aligned to decision-time
 * prices, so a news-driven rule can never be backtested or pass the evidence
 * gate. Nothing here reaches the strategy engine.
 */
export interface NewsItem {
  readonly title: string;
  readonly url: string;
  readonly source: string;
  /** Publication time in epoch milliseconds; null when the feed omitted it. */
  readonly publishedAtMs: number | null;
}

export interface PolicyItem extends NewsItem {
  /** Which watch keywords the title matched, lower-case. */
  readonly matched: readonly string[];
}

export interface NewsFeedDefinition {
  readonly source: string;
  readonly url: string;
}

export const NEWS_FEEDS: readonly NewsFeedDefinition[] = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
];

export const SEC_FEED: NewsFeedDefinition = {
  source: 'SEC',
  url: 'https://www.sec.gov/news/pressreleases.rss',
};

export const FEDERAL_REGISTER_URL =
  'https://www.federalregister.gov/api/v1/documents.json?per_page=20&order=newest' +
  '&conditions%5Bterm%5D=cryptocurrency%20OR%20%22digital%20asset%22%20OR%20stablecoin';

/** Terms that make an official document crypto-relevant. */
export const POLICY_KEYWORDS: readonly string[] = [
  'crypto',
  'cryptocurrency',
  'digital asset',
  'digital assets',
  'virtual currency',
  'stablecoin',
  'bitcoin',
  'ethereum',
  'blockchain',
  'token',
  'defi',
  'exchange-traded',
];

const MAX_FEED_BYTES = 4_000_000;
const MAX_TITLE_LENGTH = 400;

function strip(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&#0?39;|&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Minimal RSS/Atom item extractor. Deliberately tolerant: a feed that cannot be
 * parsed yields no items rather than failing the whole request, because one
 * broken publisher must not blank the other two.
 */
export function parseRssItems(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/giu) ?? [];
  for (const block of blocks) {
    const title = strip(block.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] ?? '');
    // RSS uses <link>url</link>; Atom uses <link href="url"/>.
    const href =
      block.match(/<link[^>]*href="([^"]+)"/iu)?.[1] ??
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/iu)?.[1] ??
      '';
    const url = strip(href);
    const published = strip(
      block.match(
        /<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/iu,
      )?.[1] ?? '',
    );
    if (title.length === 0 || title.length > MAX_TITLE_LENGTH) continue;
    if (!url.startsWith('https://')) continue;
    items.push({ title, url, source, publishedAtMs: publicationTime(published) });
  }
  return items;
}

/** Which policy keywords a title matches; empty means not crypto-relevant. */
export function matchPolicyKeywords(
  title: string,
  keywords: readonly string[] = POLICY_KEYWORDS,
): string[] {
  const lowered = title.toLowerCase();
  return keywords.filter((keyword) => lowered.includes(keyword));
}

function newest(left: NewsItem, right: NewsItem): number {
  return (right.publishedAtMs ?? 0) - (left.publishedAtMs ?? 0);
}

function dedupeByUrl<T extends NewsItem>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
  }
  return unique;
}

/**
 * Latest market headlines across the free feeds, newest first, deduped by URL.
 *
 * Individual feeds are allowed to fail. The request as a whole fails only when
 * every feed failed, so the caller can distinguish "the news layer is down"
 * from "one publisher is down" — the predecessor could not.
 */
export async function fetchNewsHeadlines(
  http: HttpClient,
  limit = 12,
  signal?: AbortSignal,
): Promise<ReferenceResult<readonly NewsItem[]>> {
  const collected: NewsItem[] = [];
  let lastFailure: ReferenceFailureCode | null = null;
  let succeeded = 0;

  for (const feed of NEWS_FEEDS) {
    const response = await http.getText(feed.url, signal ? { signal } : undefined);
    if (!response.ok) {
      lastFailure = referenceFailure(response);
      if (lastFailure === 'cancelled' || lastFailure === 'shutdown') {
        return { ok: false, code: lastFailure };
      }
      continue;
    }
    if (response.data.length > MAX_FEED_BYTES) {
      lastFailure = 'response_too_large';
      continue;
    }
    succeeded += 1;
    collected.push(...parseRssItems(response.data, feed.source));
  }

  if (succeeded === 0) return { ok: false, code: lastFailure ?? 'invalid_response' };

  const items = dedupeByUrl(collected).sort(newest).slice(0, Math.max(0, limit));
  return { ok: true, value: items, observedAtMs: items[0]?.publishedAtMs ?? null };
}

function federalRegisterItems(payload: unknown): PolicyItem[] {
  const body = referenceRecord(payload);
  const results = body === null ? null : body['results'];
  if (!Array.isArray(results)) return [];

  const items: PolicyItem[] = [];
  for (const candidate of results) {
    const document = referenceRecord(candidate);
    if (document === null) continue;
    const rawTitle = document['title'];
    const rawUrl = document['html_url'];
    if (typeof rawTitle !== 'string' || typeof rawUrl !== 'string') continue;
    const title = rawTitle.trim();
    if (title.length === 0 || title.length > MAX_TITLE_LENGTH) continue;
    if (!rawUrl.startsWith('https://')) continue;

    // The Federal Register term query matches full document text, which is
    // noisy: a visa rule mentioning "digital assets" once still matches. For an
    // alert surface precision beats recall, so the title must match too.
    const matched = matchPolicyKeywords(title);
    if (matched.length === 0) continue;

    const type = document['type'];
    items.push({
      title: typeof type === 'string' && type.trim().length > 0 ? `[${type.trim()}] ${title}` : title,
      url: rawUrl,
      source: 'Federal Register',
      publishedAtMs: publicationTime(document['publication_date']),
      matched,
    });
  }
  return items;
}

/**
 * Official US policy events: newest Federal Register documents matching crypto
 * terms, plus SEC press releases whose titles hit the keyword list.
 */
export async function fetchPolicyItems(
  http: HttpClient,
  limit = 10,
  signal?: AbortSignal,
): Promise<ReferenceResult<readonly PolicyItem[]>> {
  const init = signal ? { signal } : undefined;
  const collected: PolicyItem[] = [];
  let lastFailure: ReferenceFailureCode | null = null;
  let succeeded = 0;

  const register = await http.getJson<unknown>(FEDERAL_REGISTER_URL, init);
  if (register.ok) {
    succeeded += 1;
    collected.push(...federalRegisterItems(register.data));
  } else {
    lastFailure = referenceFailure(register);
    if (lastFailure === 'cancelled' || lastFailure === 'shutdown') {
      return { ok: false, code: lastFailure };
    }
  }

  const sec = await http.getText(SEC_FEED.url, init);
  if (sec.ok && sec.data.length <= MAX_FEED_BYTES) {
    succeeded += 1;
    for (const item of parseRssItems(sec.data, SEC_FEED.source)) {
      const matched = matchPolicyKeywords(item.title);
      if (matched.length > 0) collected.push({ ...item, matched });
    }
  } else if (!sec.ok) {
    lastFailure = referenceFailure(sec);
    if (lastFailure === 'cancelled' || lastFailure === 'shutdown') {
      return { ok: false, code: lastFailure };
    }
  }

  if (succeeded === 0) return { ok: false, code: lastFailure ?? 'invalid_response' };

  const items = dedupeByUrl(collected).sort(newest).slice(0, Math.max(0, limit));
  return { ok: true, value: items, observedAtMs: items[0]?.publishedAtMs ?? null };
}
