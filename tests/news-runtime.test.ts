import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemorySecretStore, secretAccountForScope, type FetchLike } from '@coqui/adapters';
import { createNewsIntelligenceRuntime, NEWS_POLL_INTERVALS_MS } from '@coqui/services';
import { listNewsObservationsAsOf, openDatabase, type Db } from '@coqui/storage';
import { currentsPayload, gdeltPayload, marketauxPayload, NEWS_NOW, newsPassThrough, newsResponse } from './fixtures/news/providers.js';
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
const databases: Db[] = [], runtimes: Awaited<ReturnType<typeof createNewsIntelligenceRuntime>>[] = [];
function db() { const database = openDatabase(':memory:'); databases.push(database); return database; }
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.destroy(); for (const database of databases.splice(0)) database.close(); });
const syntheticSecrets = () => createMemorySecretStore({ 'marketaux-api-token': 'synthetic-ma-key', 'currents-api-key': 'synthetic-cu-key' });
async function runtime(input: Parameters<typeof createNewsIntelligenceRuntime>[0]) {
  const value = await createNewsIntelligenceRuntime(input); runtimes.push(value); return value;
}

describe('opt-in news runtime', () => {
  it('allows a slow GDELT response while retaining metered deadlines and recording safe diagnostics', async () => {
    const database = db();
    const fetch: FetchLike = async url => {
      if (!String(url).includes('gdelt')) return await new Promise(() => {});
      await new Promise(resolve => setTimeout(resolve, 12_000));
      return newsResponse(gdeltPayload);
    };
    const service = await runtime({ quotaDatabase: database, storageDatabase: database, secrets: syntheticSecrets(),
      clock: { nowMs: () => NEWS_NOW }, enabledProviders: ['gdelt', 'marketaux'], fetch, rateLimiters: newsPassThrough, maxRetries: 0 });
    vi.useFakeTimers();
    try {
      const gdelt = service.manualRefresh('gdelt', { persist: true });
      await vi.advanceTimersByTimeAsync(12_001);
      expect(await gdelt).toMatchObject({ ok: true, articles: 1, inserted: 1 });
      const metered = service.manualRefresh('marketaux');
      await vi.runAllTimersAsync();
      expect(await metered).toMatchObject({ ok: false, reason: 'timeout', requestCost: 1 });
      const diagnostics = database.prepare("SELECT value FROM app_settings WHERE key LIKE 'news_%diagnostic_v1.%'").all();
      expect(JSON.stringify(diagnostics)).toContain('header_timeout');
      const meteredDiagnostic = JSON.parse(String(database.prepare("SELECT value FROM app_settings WHERE key='news_transport_diagnostic_v1.marketaux'").get()?.['value']));
      expect(meteredDiagnostic.elapsedMs).toBe(10_000);
      expect(JSON.stringify(diagnostics)).not.toMatch(/synthetic-ma-key|api_token|https:/u);
    } finally { service.destroy(); vi.useRealTimers(); }
  });
  it('records schema rejection separately from successful HTTP transport', async () => {
    const database = db();
    const service = await runtime({ quotaDatabase: database, storageDatabase: database, secrets: syntheticSecrets(),
      clock: { nowMs: () => NEWS_NOW }, enabledProviders: ['gdelt'], fetch: async () => newsResponse({ articles: [{}] }), rateLimiters: newsPassThrough });
    expect(await service.manualRefresh('gdelt', { persist: true })).toMatchObject({ ok: false, reason: 'invalid_response' });
    expect(database.prepare("SELECT value FROM app_settings WHERE key='news_ingestion_diagnostic_v1.gdelt'").get()?.['value'])
      .toContain('provider_schema_failure');
    expect(listNewsObservationsAsOf(NEWS_NOW, 100, database)).toHaveLength(0);
  });
  it('defaults off without reading secrets or dispatching requests', async () => {
    const database = db(), secrets = syntheticSecrets(), read = vi.spyOn(secrets, 'read'), fetch = vi.fn<FetchLike>();
    const service = await runtime({ quotaDatabase: database, storageDatabase: database, secrets, clock: { nowMs: () => NEWS_NOW }, fetch });
    expect(await service.manualRefresh('marketaux')).toMatchObject({ reason: 'provider_disabled', requestCost: 0 });
    expect((await service.tick()).results).toEqual([]);
    expect(service.status().every(item => !item.enabled)).toBe(true);
    expect(fetch).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it('isolates unavailable credentials while keeping GDELT usable and diagnostics secret-safe', async () => {
    const database = db(), fetch = vi.fn<FetchLike>(async () => newsResponse(gdeltPayload));
    const service = await runtime({ quotaDatabase: database, storageDatabase: database, secrets: createMemorySecretStore(),
      clock: { nowMs: () => NEWS_NOW }, enabledProviders: ['marketaux', 'currents', 'gdelt'], fetch, rateLimiters: newsPassThrough });
    expect(await service.manualRefresh('marketaux')).toMatchObject({ reason: 'credentials_unavailable' });
    expect(await service.manualRefresh('gdelt')).toMatchObject({ ok: true, articles: 1, inserted: 0 });
    expect(listNewsObservationsAsOf(NEWS_NOW, 100, database)).toHaveLength(0);
    expect(JSON.stringify(service.status())).not.toMatch(/token|key|scope|authorization/iu);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('gates metered retention before quota and supports explicit transient refresh', async () => {
    const database = db(), fetch = vi.fn<FetchLike>(async () => newsResponse(marketauxPayload));
    const service = await runtime({ quotaDatabase: database, storageDatabase: database, secrets: syntheticSecrets(),
      clock: { nowMs: () => NEWS_NOW }, enabledProviders: ['marketaux'], fetch, rateLimiters: newsPassThrough });
    expect(await service.manualRefresh('marketaux', { persist: true })).toMatchObject({ reason: 'retention_not_confirmed', requestCost: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(await service.manualRefresh('marketaux')).toMatchObject({ ok: true, requestCost: 1, inserted: 0 });
    expect(await service.manualRefresh('marketaux')).toMatchObject({ reason: 'cooldown', requestCost: 0 });
    expect(listNewsObservationsAsOf(NEWS_NOW, 100, database)).toEqual([]);
    expect((await service.tick()).results).toEqual([]);
  });
  it('shares one quota authority across profiles without mixing article storage', async () => {
    const quota = db(), first = db(), second = db(), fetch = vi.fn<FetchLike>(async () => newsResponse(currentsPayload));
    const shared = { quotaDatabase: quota, secrets: syntheticSecrets(), clock: { nowMs: () => NEWS_NOW },
      enabledProviders: ['currents'] as const, retentionPermissions: { currents: true }, fetch, rateLimiters: newsPassThrough };
    const a = await runtime({ ...shared, storageDatabase: first }), b = await runtime({ ...shared, storageDatabase: second });
    expect(await a.manualRefresh('currents', { persist: true })).toMatchObject({ ok: true, inserted: 1 });
    expect(await b.manualRefresh('currents', { persist: true })).toMatchObject({ reason: 'cooldown' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(listNewsObservationsAsOf(NEWS_NOW, 100, first)).toHaveLength(1);
    expect(listNewsObservationsAsOf(NEWS_NOW, 100, second)).toHaveLength(0);
    expect(quota.prepare('SELECT count(*) AS n FROM news_api_usage_v1').get()?.['n']).toBe(1);
  });
  it('reuses fenced UTC schedules so two hosts collect once per slot without catchup bursts', async () => {
    const database = db(); let now = NEWS_NOW;
    const fetch = vi.fn<FetchLike>(async () => newsResponse(gdeltPayload));
    const shared = { quotaDatabase: database, storageDatabase: database, secrets: syntheticSecrets(),
      clock: { nowMs: () => now }, enabledProviders: ['gdelt'] as const, fetch, rateLimiters: newsPassThrough };
    const a = await runtime({ ...shared, ownerId: 'news-host-a' }), b = await runtime({ ...shared, ownerId: 'news-host-b' });
    now += NEWS_POLL_INTERVALS_MS.gdelt;
    const ticks = await Promise.all([a.tick(), b.tick()]);
    expect(ticks.flatMap(tick => tick.results).filter(result => result.outcome === 'completed')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 10 * NEWS_POLL_INTERVALS_MS.gdelt;
    await a.tick(); expect(fetch).toHaveBeenCalledTimes(2);
    expect(listNewsObservationsAsOf(now, 100, database)).toHaveLength(1);
    a.destroy(); expect(await a.manualRefresh('gdelt')).toMatchObject({ reason: 'shutdown' });
  });
  it('counts failed authentication in diagnostics and keeps global secret scopes across wallets', async () => {
    const database = db(), fetch = vi.fn<FetchLike>(async () => newsResponse({ error: 'synthetic-secret' }, 401));
    const service = await runtime({ quotaDatabase: database, storageDatabase: database, secrets: syntheticSecrets(),
      clock: { nowMs: () => NEWS_NOW }, enabledProviders: ['marketaux'], fetch, rateLimiters: newsPassThrough });
    expect(await service.manualRefresh('marketaux')).toEqual({ provider: 'marketaux', ok: false, reason: 'authentication_failed', articles: 0, inserted: 0, requestCost: 1 });
    expect(secretAccountForScope('wallet-a', 'marketaux-api-token')).toBe(secretAccountForScope('wallet-b', 'marketaux-api-token'));
    expect(secretAccountForScope('wallet-a', 'currents-api-key')).toBe(secretAccountForScope('wallet-b', 'currents-api-key'));
  });
});

describe('news credential rotation', () => {
  it('keeps one quota pool after changing the credential instead of resetting allowance', async () => {
    const database = db(), fetch = vi.fn<FetchLike>(async () => newsResponse(marketauxPayload));
    const input = { quotaDatabase: database, storageDatabase: database, clock: { nowMs: () => NEWS_NOW },
      enabledProviders: ['marketaux'] as const, fetch, rateLimiters: newsPassThrough };
    const first = await runtime({ ...input, secrets: createMemorySecretStore({ 'marketaux-api-token': 'synthetic-first-key' }) });
    expect(await first.manualRefresh('marketaux')).toMatchObject({ ok: true, requestCost: 1 }); first.destroy();
    const second = await runtime({ ...input, secrets: createMemorySecretStore({ 'marketaux-api-token': 'synthetic-rotated-key' }) });
    expect(await second.manualRefresh('marketaux')).toMatchObject({ reason: 'cooldown', requestCost: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(database.prepare('SELECT count(*) AS n FROM news_api_usage_v1').get()?.['n']).toBe(1);
  });
});
