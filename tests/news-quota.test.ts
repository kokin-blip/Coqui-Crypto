import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGovernedNewsTransport } from '@coqui/services';
import { deferNewsRequests, finishNewsRequest, migrations, newsQuotaDay, nextNewsQuotaReset, openDatabase,
  readNewsQuotaUsage, reserveNewsRequest, type Db } from '@coqui/storage';
import type { NewsHttpResult, NewsHttpTransport } from '@coqui/adapters';
import { NEWS_NOW } from './fixtures/news/providers.js';
const scope = 'a'.repeat(64), databases: Db[] = [], directories: string[] = [];
function db(path = ':memory:') { const database = openDatabase(path); databases.push(database); return database; }
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const success: NewsHttpResult = { ok: true, data: {}, receivedAtMs: NEWS_NOW, attempts: 1 };
function failure(status: number, retryAfterMs: number | null = null): NewsHttpResult {
  return { ok: false, status, reason: status ? 'http' : 'network', retryAfterMs, attempts: 1 };
}
function setup(results: NewsHttpResult[], provider: 'marketaux' | 'currents' | 'gdelt' = 'marketaux', budget = 10) {
  const database = db(); let now = NEWS_NOW;
  const request = vi.fn<NewsHttpTransport['request']>(async () => results.shift() ?? success);
  const sleep = vi.fn(async (ms: number) => { now += ms; });
  const transport = createGovernedNewsTransport({ provider, scope, database, clock: { nowMs: () => now },
    transport: { request, destroy() {} }, budget, sleep, random: () => 0 });
  return { database, request, sleep, transport, time: () => now };
}
describe('persistent news quota reservations', () => {
  it('reserves every retry and records success and failure once', async () => {
    const test = setup([failure(503), failure(408), success]);
    expect(await test.transport.request('https://api.example')).toMatchObject({ ok: true, attempts: 3 });
    expect(test.request).toHaveBeenCalledTimes(3); expect(test.sleep).toHaveBeenCalledTimes(2);
    expect(readNewsQuotaUsage('marketaux', scope, test.time(), test.database)).toEqual({ budget: 10, reserved: 3, failed: 2, succeeded: 1 });
    const id = test.database.prepare('SELECT id FROM news_request_attempts_v1 LIMIT 1').get()?.['id'] as string;
    expect(() => finishNewsRequest(id, true, 200, 'succeeded', test.time(), test.database)).toThrow('already finalized');
    expect(() => test.database.exec('DELETE FROM news_request_attempts_v1')).toThrow('cannot be deleted');
  });
  it.each([401, 403, 400])('does not retry terminal HTTP %s', async status => {
    const test = setup([failure(status)]);
    expect(await test.transport.request('https://api.example')).toMatchObject({ ok: false, status, attempts: 1 });
    expect(test.sleep).not.toHaveBeenCalled(); expect(test.request).toHaveBeenCalledTimes(1);
  });
  it.each([402, 429])('persists provider throttle %s and prevents manual retry', async status => {
    const test = setup([failure(status, 60_000)]);
    expect(await test.transport.request('https://api.example')).toMatchObject({ ok: false, status, attempts: 1 });
    expect(await test.transport.request('https://api.example')).toMatchObject({ ok: false, reason: 'cooldown', attempts: 0 });
    expect(test.request).toHaveBeenCalledTimes(1);
  });
  it('honors short Retry-After and defers long waits instead of holding scheduler leases', async () => {
    const short = setup([failure(503, 2_000), success]);
    expect(await short.transport.request('https://api.example')).toMatchObject({ ok: true, attempts: 2 });
    expect(short.sleep).toHaveBeenCalledWith(2_000, undefined);
    const long = setup([failure(503, 30_000)]);
    expect(await long.transport.request('https://api.example')).toMatchObject({ ok: false, attempts: 1 });
    expect(long.sleep).not.toHaveBeenCalled();
    expect(await long.transport.request('https://api.example')).toMatchObject({ reason: 'cooldown', attempts: 0 });
  });
  it('uses conservative GDELT courtesy pacing and caps retries by remaining quota', async () => {
    const gdelt = setup([failure(503)], 'gdelt');
    await gdelt.transport.request('https://api.example');
    expect(gdelt.sleep).not.toHaveBeenCalled();
    expect(await gdelt.transport.request('https://api.example')).toMatchObject({ reason: 'cooldown', attempts: 0 });
    const limited = setup([failure(503)], 'marketaux', 1);
    expect(await limited.transport.request('https://api.example')).toMatchObject({ reason: 'quota_exhausted', attempts: 1 });
    expect(limited.request).toHaveBeenCalledTimes(1);
  });
  it('shares ceilings across reopened connections and never refunds an interrupted reservation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coqui-news-quota-')); directories.push(directory);
    const path = join(directory, 'shared.db'), first = db(path), second = db(path);
    const reserve = (database: Db, now: number, budget = 2) => reserveNewsRequest({ provider: 'currents', scope, now, budget, spacingMs: 1 }, database);
    expect(reserve(first, NEWS_NOW).ok).toBe(true);
    expect(reserve(second, NEWS_NOW)).toMatchObject({ reason: 'cooldown' });
    expect(reserve(second, NEWS_NOW + 1).ok).toBe(true);
    expect(reserve(first, NEWS_NOW + 2, 250)).toMatchObject({ reason: 'quota_exhausted' });
    first.close(); databases.splice(databases.indexOf(first), 1);
    expect(readNewsQuotaUsage('currents', scope, NEWS_NOW, db(path))).toEqual({ budget: 2, reserved: 2, failed: 0, succeeded: 0 });
  });
  it('resets at UTC midnight while keeping authoritative cooldowns and credential scopes independent', () => {
    const database = db(), midnight = nextNewsQuotaReset(NEWS_NOW);
    expect(newsQuotaDay(midnight - 1)).toBe('2026-10-08'); expect(newsQuotaDay(midnight)).toBe('2026-10-09');
    const reserve = (now: number, key = scope) => reserveNewsRequest({ provider: 'currents', scope: key, now, budget: 1, spacingMs: 1 }, database);
    expect(reserve(midnight - 1).ok).toBe(true); expect(reserve(midnight).ok).toBe(true);
    expect(reserve(midnight + 1)).toMatchObject({ reason: 'quota_exhausted' });
    expect(reserve(midnight + 1, 'b'.repeat(64)).ok).toBe(true);
    deferNewsRequests('currents', scope, midnight + 100_000, database);
    deferNewsRequests('currents', scope, midnight + 2, database);
    expect(reserve(midnight + 2)).toMatchObject({ reason: 'cooldown', retryAtMs: midnight + 100_000 });
    expect(() => newsQuotaDay(NaN)).toThrow();
  });
  it('blocks already canceled dispatch without consuming quota', async () => {
    const test = setup([]), controller = new AbortController(); controller.abort();
    expect(await test.transport.request('https://api.example', { signal: controller.signal })).toMatchObject({ reason: 'canceled', attempts: 0 });
    expect(test.request).not.toHaveBeenCalled(); expect(readNewsQuotaUsage('marketaux', scope, NEWS_NOW, test.database)).toBeNull();
  });
  it('upgrades v88 with a backup without modifying existing article evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coqui-news-v89-')); directories.push(directory);
    const path = join(directory, 'profile.db'), old = openDatabase(path, { migrations: migrations.slice(0, 88) });
    old.prepare("INSERT INTO app_settings(key,value) VALUES ('synthetic-preserved','yes')").run(); old.close();
    const database = db(path);
    expect(database.prepare('PRAGMA user_version').get()?.['user_version']).toBe(89);
    expect(database.prepare("SELECT value FROM app_settings WHERE key='synthetic-preserved'").get()?.['value']).toBe('yes');
    expect(readdirSync(directory).some(name => name.includes('pre-migration-v88'))).toBe(true);
    const reserved = reserveNewsRequest({ provider: 'marketaux', scope, now: NEWS_NOW, budget: 1, spacingMs: 1 }, database);
    expect(reserved.ok).toBe(true);
    if (reserved.ok) expect(() => database.prepare("UPDATE news_request_attempts_v1 SET outcome='failed',reason='http' WHERE id=?").run(reserved.id)).toThrow('CHECK');
  });
});

describe('stable provider pools and legacy carry-forward', () => {
  it('carries counts and cooldowns once, including later completion, and resets current-day accounting at UTC midnight', async () => {
    const { newsProviderQuotaScope } = await import('@coqui/storage');
    const database = db(), pooled = newsProviderQuotaScope('currents');
    const prior = reserveNewsRequest({ provider: 'currents', scope, now: NEWS_NOW, budget: 2, spacingMs: 1000 }, database);
    expect(prior.ok).toBe(true);
    deferNewsRequests('currents', scope, NEWS_NOW + 2000, database);
    const reserve = (now: number) => reserveNewsRequest({ provider: 'currents', scope: pooled, now, budget: 200, spacingMs: 1 }, database);
    expect(reserve(NEWS_NOW)).toMatchObject({ reason: 'cooldown', retryAtMs: NEWS_NOW + 2000 });
    expect(readNewsQuotaUsage('currents', pooled, NEWS_NOW, database)).toEqual({ budget: 2, reserved: 1, succeeded: 0, failed: 0 });
    if (prior.ok) finishNewsRequest(prior.id, true, 200, 'succeeded', NEWS_NOW + 1, database);
    expect(reserve(NEWS_NOW + 2000).ok).toBe(true);
    expect(reserve(NEWS_NOW + 2001)).toMatchObject({ reason: 'quota_exhausted' });
    expect(readNewsQuotaUsage('currents', pooled, NEWS_NOW, database)).toEqual({ budget: 2, reserved: 2, succeeded: 1, failed: 0 });
    expect(reserve(nextNewsQuotaReset(NEWS_NOW)).ok).toBe(true);
    expect(database.prepare('SELECT count(*) AS n FROM news_request_attempts_v1 WHERE scope=?').get(scope)?.['n']).toBe(1);
  });
});

describe('news dispatch lifecycle guards', () => {
  it('prevents retry after host ownership is lost', async () => {
    const database = db(); let active = true, now = NEWS_NOW;
    const request = vi.fn<NewsHttpTransport['request']>(async () => { active = false; return failure(503); });
    const transport = createGovernedNewsTransport({ provider: 'marketaux', scope, database, budget: 85,
      clock: { nowMs: () => now }, canRequest: () => active, transport: { request, destroy() {} },
      sleep: async ms => { now += ms; } });
    expect(await transport.request('https://api.example')).toMatchObject({ reason: 'host_inactive', attempts: 1 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(readNewsQuotaUsage('marketaux', scope, now, database)?.reserved).toBe(1);
  });
  it('bounds transient validation to one attempt even for retryable errors', async () => {
    const database = db(), request = vi.fn<NewsHttpTransport['request']>(async () => failure(503));
    const transport = createGovernedNewsTransport({ provider: 'marketaux', scope, database, budget: 85,
      clock: { nowMs: () => NEWS_NOW }, maxRetries: 0, transport: { request, destroy() {} } });
    expect(await transport.request('https://api.example')).toMatchObject({ status: 503, attempts: 1 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
