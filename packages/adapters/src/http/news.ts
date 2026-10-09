import type { Clock } from '@coqui/core';
import { createHttpClient, type FetchLike, type HttpRequestInit } from './client.js';
import { createRateLimiterRegistry, type RateLimiterRegistry } from './rate-limiter.js';

export type NewsHttpResult =
  | { readonly ok: true; readonly data: unknown; readonly receivedAtMs: number; readonly attempts: number }
  | { readonly ok: false; readonly status: number; readonly reason: string;
      readonly retryAfterMs: number | null; readonly attempts: number };

export interface NewsHttpTransport {
  request(url: string, init?: HttpRequestInit): Promise<NewsHttpResult>;
  destroy(): void;
}

/** One HTTP attempt only. The persistent governor owns all retries and accounting. */
export function createNewsHttpTransport(input: { readonly clock: Clock; readonly fetch?: FetchLike;
  readonly rateLimiters?: RateLimiterRegistry; readonly timeoutMs?: number }): NewsHttpTransport {
  const owned = input.rateLimiters ? undefined : createRateLimiterRegistry({
    'api.marketaux.com': { requests: 1, windowMs: 1_000 },
    'api.currentsapi.services': { requests: 1, windowMs: 1_000 },
    'api.gdeltproject.org': { requests: 1, windowMs: 30_000 },
  });
  const clients = new Set<ReturnType<typeof createHttpClient>>();
  let destroyed = false;
  return {
    async request(url, init = {}) {
      if (destroyed) return { ok: false, status: 0, reason: 'shutdown', retryAfterMs: null, attempts: 0 };
      let retryAfterMs: number | null = null, attempts = 0;
      const client = createHttpClient({ maxRetries: 0, timeoutMs: input.timeoutMs ?? 10_000,
        maxElapsedMs: 15_000, rateLimiters: input.rateLimiters ?? owned!,
        fetch: async (target, request) => {
          attempts += 1;
          const response = await (input.fetch ?? fetch)(target, { ...request, redirect: 'error' });
          const raw = response.headers.get('retry-after');
          if (raw !== null) {
            const seconds = Number(raw);
            const duration = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : Date.parse(raw) - input.clock.nowMs();
            if (Number.isFinite(duration)) retryAfterMs = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.ceil(duration)));
          }
          return response;
        },
      });
      clients.add(client);
      try {
        const result = await client.consumeStream!(url, async response => {
          const length = Number(response.headers.get('content-length') ?? 0);
          if (length > 4_000_000) throw new Error('news_response_too_large');
          let text: string;
          if (response.body) {
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let size = 0; text = '';
            try {
              for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 4_000_000) { await reader.cancel(); throw new Error('news_response_too_large'); }
                text += decoder.decode(chunk.value, { stream: true });
              }
              text += decoder.decode();
            } finally { reader.releaseLock(); }
          } else { text = await response.text(); }
          if (Buffer.byteLength(text, 'utf8') > 4_000_000) throw new Error('news_response_too_large');
          return JSON.parse(text) as unknown;
        }, { ...init, redirect: 'error', requestPriority: 'research' });
        return result.ok
          ? { ok: true, data: result.data, receivedAtMs: input.clock.nowMs(), attempts }
          : { ok: false, status: result.status, reason: result.reason, retryAfterMs, attempts };
      } finally { client.destroy(); clients.delete(client); }
    },
    destroy() { destroyed = true; for (const client of clients) client.destroy(); owned?.destroyAll(); },
  };
}
