import { setTimeout as delay } from 'node:timers/promises';
import type { Clock, NewsProviderId } from '@coqui/core';
import type { NewsHttpResult, NewsHttpTransport } from '@coqui/adapters';
import { deferNewsRequests, finishNewsRequest, nextNewsQuotaReset, reserveNewsRequest,
  type Db } from '@coqui/storage';

/** Counts every attempt, including retries; an interrupted reservation is never refunded. */
export function createGovernedNewsTransport(input: { readonly provider: NewsProviderId; readonly scope: string;
  readonly database: Db; readonly clock: Clock; readonly transport: NewsHttpTransport;
  readonly budget: number; readonly sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
  readonly canRequest?: () => boolean; readonly maxRetries?: 0 | 1 | 2; readonly random?: () => number }): NewsHttpTransport {
  const spacingMs = input.provider === 'gdelt' ? 30_000 : 1_000;
  const sleep = input.sleep ?? (async (ms, signal) => { await delay(ms, undefined, signal ? { signal } : undefined); });
  let destroyed = false;
  return { async request(url, init = {}) {
    let attempts = 0;
    const failed = (reason: string): NewsHttpResult => ({ ok: false, status: 0, reason, retryAfterMs: null, attempts });
    for (let retry = 0; retry <= (input.maxRetries ?? 2); retry += 1) {
      if (destroyed) return failed('shutdown');
      if (init.signal?.aborted) return failed('canceled');
      if (input.canRequest && !input.canRequest()) return failed('host_inactive');
      const reservation = reserveNewsRequest({ provider: input.provider, scope: input.scope, now: input.clock.nowMs(),
        budget: input.budget, spacingMs }, input.database);
      if (!reservation.ok) return failed(reservation.reason);
      attempts += 1;
      let result: NewsHttpResult;
      try { result = await input.transport.request(url, init); }
      catch { result = { ok: false, status: 0, reason: 'network', retryAfterMs: null, attempts: 1 }; }
      if (destroyed) return failed('shutdown');
      const now = input.clock.nowMs();
      finishNewsRequest(reservation.id, result.ok, result.ok ? 200 : result.status,
        result.ok ? 'succeeded' : result.reason.replaceAll('-', '_'), now, input.database);
      if (result.ok) return { ...result, attempts };
      if (result.status === 402 || result.status === 429) {
        const fallback = result.status === 402 ? 86_400_000 : input.provider === 'currents'
          ? nextNewsQuotaReset(now) - now : 60_000;
        deferNewsRequests(input.provider, input.scope, now + Math.max(1_000, result.retryAfterMs ?? fallback), input.database);
        return { ...result, attempts };
      }
      const retryable = result.status === 408 || result.status >= 500 || ['network', 'timeout'].includes(result.reason);
      if (!retryable || retry === (input.maxRetries ?? 2)) return { ...result, attempts };
      const wait = Math.max(spacingMs, result.retryAfterMs ?? (250 * 2 ** retry + (input.random ?? Math.random)() * 250));
      if (wait > 5_000) { deferNewsRequests(input.provider, input.scope, now + wait, input.database); return { ...result, attempts }; }
      try { await sleep(Math.ceil(wait), init.signal); } catch { return failed('canceled'); }
    }
    return failed('network');
  }, destroy() { destroyed = true; input.transport.destroy(); } };
}
