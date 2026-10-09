import { randomUUID } from 'node:crypto';
import { isNewsTimestamp, sha256Hex, type NewsProviderId } from '@coqui/core';
import { getSetting, setSetting } from './settings.js';
import { inTransaction, type Db } from '../sqlite/index.js';

const DAY = 86_400_000;
export const NEWS_FREE_LIMITS = { marketaux: 100, currents: 250, gdelt: 144 } as const;
export function newsQuotaDay(now: number): string {
  if (!isNewsTimestamp(now) || now > 8_639_999_913_600_000) throw new TypeError('Invalid news quota time.');
  return new Date(now).toISOString().slice(0, 10);
}
export const nextNewsQuotaReset = (now: number): number => { newsQuotaDay(now); return (Math.floor(now / DAY) + 1) * DAY; };
function scopeValid(provider: NewsProviderId, scope: string): void {
  if (!Object.hasOwn(NEWS_FREE_LIMITS, provider) || !/^[a-f0-9]{64}$/u.test(scope)) throw new TypeError('Invalid news quota scope.');
}
/** One conservative account pool per provider in the shared authority database. */
export const newsProviderQuotaScope = (provider: NewsProviderId): string => sha256Hex(`news-provider-pool-v1:${provider}`);

function carryForwardNewsQuota(provider: NewsProviderId, scope: string, day: string, budget: number, database: Db): void {
  const key = `news_quota_carry_v1:${provider}:${day}`;
  const previous = getSetting(key, database);
  let carried = { reserved: 0, succeeded: 0, failed: 0 };
  if (previous !== null) {
    try { carried = JSON.parse(previous) as typeof carried; } catch { throw new Error('Invalid news quota carry-forward state.'); }
    if (!carried || Object.keys(carried).length !== 3 ||
      !['reserved', 'succeeded', 'failed'].every(field => Number.isSafeInteger(carried[field as keyof typeof carried]) && carried[field as keyof typeof carried] >= 0) ||
      carried.succeeded + carried.failed > carried.reserved) throw new Error('Invalid news quota carry-forward state.');
  }
  const legacy = database.prepare(`SELECT coalesce(sum(reserved),0) AS reserved, coalesce(sum(succeeded),0) AS succeeded,
    coalesce(sum(failed),0) AS failed, min(budget) AS budget FROM news_api_usage_v1 WHERE provider=? AND scope<>? AND quota_day=?`)
    .get(provider, scope, day) as { reserved: number; succeeded: number; failed: number; budget: number | null };
  database.prepare('INSERT OR IGNORE INTO news_api_usage_v1(provider,scope,quota_day,budget) VALUES (?,?,?,?)')
    .run(provider, scope, day, budget);
  database.prepare(`UPDATE news_api_usage_v1 SET budget=min(budget,?),reserved=reserved+?,succeeded=succeeded+?,failed=failed+?
    WHERE provider=? AND scope=? AND quota_day=?`).run(Math.min(budget, legacy.budget ?? budget),
      Math.max(0, legacy.reserved - carried.reserved), Math.max(0, legacy.succeeded - carried.succeeded),
      Math.max(0, legacy.failed - carried.failed), provider, scope, day);
  setSetting(key, JSON.stringify({ reserved: Math.max(carried.reserved, legacy.reserved),
    succeeded: Math.max(carried.succeeded, legacy.succeeded), failed: Math.max(carried.failed, legacy.failed) }), database);
  const controls = database.prepare(`SELECT coalesce(max(blocked_until),0) AS blocked_until,
    coalesce(max(next_dispatch_at),0) AS next_dispatch_at FROM news_api_controls_v1 WHERE provider=? AND scope<>?`)
    .get(provider, scope) as { blocked_until: number; next_dispatch_at: number };
  database.prepare(`INSERT INTO news_api_controls_v1(provider,scope,blocked_until,next_dispatch_at) VALUES (?,?,?,?)
    ON CONFLICT(provider,scope) DO UPDATE SET blocked_until=max(blocked_until,excluded.blocked_until),
    next_dispatch_at=max(next_dispatch_at,excluded.next_dispatch_at)`).run(provider, scope, controls.blocked_until, controls.next_dispatch_at);
}

export interface NewsQuotaUsage { readonly budget: number; readonly reserved: number; readonly succeeded: number; readonly failed: number }
export function readNewsQuotaUsage(provider: NewsProviderId, scope: string, now: number, database: Db): NewsQuotaUsage | null {
  scopeValid(provider, scope);
  const row = database.prepare(`SELECT budget,reserved,succeeded,failed FROM news_api_usage_v1 WHERE provider=? AND scope=? AND quota_day=?`)
    .get(provider, scope, newsQuotaDay(now)) as unknown as NewsQuotaUsage | undefined;
  return row ? Object.freeze(row) : null;
}
export type NewsQuotaReservation = { readonly ok: true; readonly id: string } |
  { readonly ok: false; readonly reason: 'quota_exhausted' | 'cooldown'; readonly retryAtMs: number };

/** Shared authority database, credential fingerprint scope, atomic reserve-before-dispatch. */
export function reserveNewsRequest(input: { readonly provider: NewsProviderId; readonly scope: string;
  readonly now: number; readonly budget: number; readonly spacingMs: number }, database: Db): NewsQuotaReservation {
  const { provider, scope, now, budget, spacingMs } = input; scopeValid(provider, scope);
  const day = newsQuotaDay(now);
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > NEWS_FREE_LIMITS[provider] ||
    !Number.isSafeInteger(spacingMs) || spacingMs < 1 || spacingMs > DAY) throw new TypeError('Invalid news quota policy.');
  return inTransaction(database, () => {
    if (scope === newsProviderQuotaScope(provider)) carryForwardNewsQuota(provider, scope, day, budget, database);
    database.prepare('INSERT OR IGNORE INTO news_api_controls_v1(provider,scope) VALUES (?,?)').run(provider, scope);
    const controls = database.prepare('SELECT blocked_until,next_dispatch_at FROM news_api_controls_v1 WHERE provider=? AND scope=?')
      .get(provider, scope) as { blocked_until: number; next_dispatch_at: number };
    const retryAtMs = Math.max(controls.blocked_until, controls.next_dispatch_at);
    if (retryAtMs > now) return { ok: false, reason: 'cooldown', retryAtMs };
    database.prepare('INSERT OR IGNORE INTO news_api_usage_v1(provider,scope,quota_day,budget) VALUES (?,?,?,?)').run(provider, scope, day, budget);
    // A second process may lower a day's budget, but cannot silently raise it.
    database.prepare('UPDATE news_api_usage_v1 SET budget=min(budget,?) WHERE provider=? AND scope=? AND quota_day=?')
      .run(budget, provider, scope, day);
    const usage = readNewsQuotaUsage(provider, scope, now, database)!;
    if (usage.reserved >= usage.budget) return { ok: false, reason: 'quota_exhausted', retryAtMs: nextNewsQuotaReset(now) };
    const id = randomUUID();
    database.prepare('UPDATE news_api_usage_v1 SET reserved=reserved+1 WHERE provider=? AND scope=? AND quota_day=?').run(provider, scope, day);
    database.prepare('UPDATE news_api_controls_v1 SET next_dispatch_at=? WHERE provider=? AND scope=?').run(now + spacingMs, provider, scope);
    database.prepare('INSERT INTO news_request_attempts_v1(id,provider,scope,quota_day,reserved_at) VALUES (?,?,?,?,?)').run(id, provider, scope, day, now);
    return { ok: true, id };
  });
}

export function finishNewsRequest(id: string, success: boolean, status: number, reason: string, at: number, database: Db): void {
  newsQuotaDay(at);
  if (!Number.isInteger(status) || status < 0 || status > 599 || !/^[a-z][a-z0-9_]{0,63}$/u.test(reason)) throw new TypeError('Invalid news request outcome.');
  inTransaction(database, () => {
    const row = database.prepare('SELECT provider,scope,quota_day FROM news_request_attempts_v1 WHERE id=? AND outcome=\'reserved\'')
      .get(id) as { provider: string; scope: string; quota_day: string } | undefined;
    if (!row) throw new Error('News request is absent or already finalized.');
    database.prepare('UPDATE news_request_attempts_v1 SET outcome=?,completed_at=?,http_status=?,reason=? WHERE id=?')
      .run(success ? 'succeeded' : 'failed', at, status, reason, id);
    const column = success ? 'succeeded' : 'failed';
    database.prepare(`UPDATE news_api_usage_v1 SET ${column}=${column}+1 WHERE provider=? AND scope=? AND quota_day=?`)
      .run(row.provider, row.scope, row.quota_day);
  });
}
export function deferNewsRequests(provider: NewsProviderId, scope: string, until: number, database: Db): void {
  scopeValid(provider, scope); newsQuotaDay(until);
  database.prepare(`INSERT INTO news_api_controls_v1(provider,scope,blocked_until) VALUES (?,?,?)
    ON CONFLICT(provider,scope) DO UPDATE SET blocked_until=max(blocked_until,excluded.blocked_until)`).run(provider, scope, until);
}
