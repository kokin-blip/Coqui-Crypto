import { randomUUID } from 'node:crypto';
import { type Clock, type NewsProvider, type NewsProviderId, type NewsQuery } from '@coqui/core';
import { createCurrentsNewsProvider, createGdeltNewsProvider, createMarketauxNewsProvider,
  createNewsHttpTransport, NewsProviderError, type FetchLike, type GdeltNewsProvider,
  type NewsHttpTransport, type SecretStore, type RateLimiterRegistry } from '@coqui/adapters';
import { ensureWalletUtcSchedule, newsProviderQuotaScope, setSetting, type Db } from '@coqui/storage';
import { WalletSchedulerService, type WalletSchedulerTask } from '../scheduler/index.js';
import { createGovernedNewsTransport } from './quota-governor.js';
import { NewsStorageService } from './service.js';

export const NEWS_POLL_INTERVALS_MS = { marketaux: 20 * 60_000, currents: 10 * 60_000, gdelt: 30 * 60_000 } as const;
export const NEWS_DAILY_BUDGETS = { marketaux: 85, currents: 200, gdelt: 72 } as const;
const IDS: readonly NewsProviderId[] = ['marketaux', 'currents', 'gdelt'];

export function defaultNewsQuery(provider: NewsProviderId, slot: number): NewsQuery {
  if (provider === 'marketaux') return { keywords: ['bitcoin', 'ethereum', 'solana'], limit: 3 };
  if (provider === 'currents') return { keywords: [['bitcoin'], ['Federal Reserve'], ['cryptocurrency regulation'], ['stablecoin']][Math.abs(slot) % 4]!, limit: 20 };
  return { keywords: ['Bitcoin', 'Ethereum', 'cryptocurrency'], limit: 100 };
}

export interface NewsRefreshResult {
  readonly provider: NewsProviderId; readonly ok: boolean; readonly reason: string | null;
  readonly articles: number; readonly inserted: number; readonly requestCost: number;
}

/** Opt-in host composition; no timers, renderer API, credential enrollment or automatic activation. */
export async function createNewsIntelligenceRuntime(input: {
  readonly clock: Clock; readonly secrets: SecretStore;
  /** One fixed existing operational database shared by EVERY profile/process using these keys. */
  readonly quotaDatabase: Db;
  readonly storageDatabase: Db;
  readonly enabledProviders?: readonly NewsProviderId[];
  readonly retentionPermissions?: Partial<Readonly<Record<NewsProviderId, boolean>>>;
  readonly ownerId?: string;
  readonly fetch?: FetchLike;
  readonly rateLimiters?: RateLimiterRegistry;
  readonly maxRetries?: 0 | 1 | 2;
  readonly startCurrentSlot?: boolean;
  readonly canCollect?: () => boolean;
  readonly sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
}) {
  if (input.enabledProviders?.some(provider => !IDS.includes(provider))) throw new TypeError('Invalid news provider configuration.');
  const enabled = new Set(input.enabledProviders ?? []);
  const providers = new Map<NewsProviderId, NewsProvider>(), scopes = new Map<NewsProviderId, string>();
  const unavailable = new Map<NewsProviderId, string>(), transports: NewsHttpTransport[] = [];
  const storage = new NewsStorageService({ database: input.storageDatabase, clock: input.clock });
  const shutdown = new AbortController();
  const retained = (provider: NewsProviderId) => input.retentionPermissions?.[provider] ?? provider === 'gdelt';
  for (const provider of IDS.filter(id => enabled.has(id))) {
    let key: string | null = null;
    if (provider !== 'gdelt') {
      let read;
      try { read = await input.secrets.read(provider === 'marketaux' ? 'marketaux-api-token' : 'currents-api-key'); }
      catch { unavailable.set(provider, 'credentials_unavailable'); continue; }
      if (!read.ok || read.value === null) { unavailable.set(provider, 'credentials_unavailable'); continue; }
      key = read.value;
    }
    const scope = newsProviderQuotaScope(provider);
    const raw = createNewsHttpTransport({ clock: input.clock, ...(input.fetch ? { fetch: input.fetch } : {}),
      ...(input.rateLimiters ? { rateLimiters: input.rateLimiters } : {}),
      ...(provider === 'gdelt' ? { timeoutMs: 30_000, maxElapsedMs: 35_000 } : {}) });
    const transport = createGovernedNewsTransport({ provider, scope, database: input.quotaDatabase, clock: input.clock,
      transport: raw, budget: NEWS_DAILY_BUDGETS[provider], ...(input.canCollect ? { canRequest: input.canCollect } : {}), ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }), ...(input.sleep ? { sleep: input.sleep } : {}) });
    try {
      const source = provider === 'marketaux' ? createMarketauxNewsProvider({ transport, token: key!, clock: input.clock })
        : provider === 'currents' ? createCurrentsNewsProvider({ transport, key: key!, clock: input.clock })
          : createGdeltNewsProvider({ transport, clock: input.clock });
      providers.set(provider, source); scopes.set(provider, scope); transports.push(transport);
    } catch { raw.destroy(); unavailable.set(provider, 'invalid_credentials'); }
  }
  async function manualRefresh(provider: NewsProviderId, options: { readonly persist?: boolean;
    readonly query?: NewsQuery; readonly signal?: AbortSignal } = {}): Promise<NewsRefreshResult> {
    const failure = (reason: string, requestCost = 0): NewsRefreshResult => ({ provider, ok: false, reason, articles: 0, inserted: 0, requestCost });
    if (shutdown.signal.aborted) return failure('shutdown');
    if (input.canCollect && !input.canCollect()) return failure('host_inactive');
    if (!enabled.has(provider)) return failure('provider_disabled');
    if (options.persist && !retained(provider)) return failure('retention_not_confirmed');
    const source = providers.get(provider);
    if (!source) return failure(unavailable.get(provider) ?? 'provider_unavailable');
    let requestCost = 0;
    const startedAt = performance.now();
    const record = (code: string, articles: number) => {
      if (shutdown.signal.aborted || (input.canCollect && !input.canCollect())) return;
      setSetting(`news_ingestion_diagnostic_v1.${provider}`, JSON.stringify({ schemaVersion: 1,
        atMs: input.clock.nowMs(), code, articles,
        elapsedMs: Math.min(86_400_000, Math.max(0, Math.ceil(performance.now() - startedAt))) }), input.storageDatabase);
    };
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, shutdown.signal]) : shutdown.signal;
      const result = await source.fetchLatest(options.query ?? defaultNewsQuery(provider,
        Math.floor(input.clock.nowMs() / NEWS_POLL_INTERVALS_MS[provider])), signal);
      requestCost = result.requestCost;
      if (signal.aborted) return failure('canceled', requestCost);
      if (input.canCollect && !input.canCollect()) return failure('host_inactive', requestCost);
      const inserted = options.persist && result.articles.length ? storage.ingest(result.articles).filter(row => row.inserted).length : 0;
      record('succeeded', result.articles.length);
      return { provider, ok: true, reason: null, articles: result.articles.length, inserted, requestCost: result.requestCost };
    } catch (error) {
      record(error instanceof NewsProviderError && error.code === 'invalid_response' ? 'provider_schema_failure' : 'ingestion_failed', 0);
      return failure(error instanceof NewsProviderError && /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)
        ? error.code : 'ingestion_failed', error instanceof NewsProviderError ? error.requestCost : requestCost);
    }
  }
  const scheduler = new WalletSchedulerService({ database: input.quotaDatabase, clock: input.clock,
    ownerId: input.ownerId ?? randomUUID() });
  const tasks: WalletSchedulerTask[] = IDS.filter(provider => providers.has(provider) && retained(provider)).map(provider => ({
    profileId: `news.${provider}.${scopes.get(provider)!.slice(0, 32)}`,
    cadenceMs: NEWS_POLL_INTERVALS_MS[provider], catchUpPolicy: 'recompute_current',
    async execute(context) {
      const result = await manualRefresh(provider, { persist: true, signal: context.signal,
        query: defaultNewsQuery(provider, Math.floor(context.scheduledForMs / NEWS_POLL_INTERVALS_MS[provider])) });
      return result.ok ? { status: 'completed' } : { status: 'degraded', reasonCode: result.reason ?? 'ingestion_failed' };
    },
  }));
  if (input.startCurrentSlot) for (const task of tasks) {
    ensureWalletUtcSchedule(task.profileId, task.cadenceMs, 0,
      Math.floor(input.clock.nowMs() / task.cadenceMs) * task.cadenceMs, input.quotaDatabase);
  }
  scheduler.ensureSchedules(tasks);
  return {
    manualRefresh,
    /** The host owns its wake-up loop; calling tick is explicit. */
    tick: () => scheduler.tick(tasks),
    async fetchGdeltCoverage(query: NewsQuery, signal?: AbortSignal) {
      if (shutdown.signal.aborted || !providers.has('gdelt')) throw new NewsProviderError('provider_disabled');
      return await (providers.get('gdelt') as GdeltNewsProvider).fetchCoverage(query,
        signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal);
    },
    status: () => IDS.map(provider => Object.freeze({ provider, enabled: enabled.has(provider),
      configured: providers.has(provider), canPersist: retained(provider), reason: unavailable.get(provider) ?? null })),
    destroy() { shutdown.abort(); scheduler.dispose(); for (const transport of transports) transport.destroy(); },
  };
}
