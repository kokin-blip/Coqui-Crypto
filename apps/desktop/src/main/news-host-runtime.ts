import { resolve } from 'node:path';
import type { Clock } from '@coqui/core';
import { createMemorySecretStore, type FetchLike, type RateLimiterRegistry, type SecretStore } from '@coqui/adapters';
import { createNewsIntelligenceRuntime, readNewsHostConfiguration, validateNewsHostConfiguration, type NewsHostConfiguration } from '@coqui/services';
import { isAuthoritativeHost, openDatabase } from '@coqui/storage';

type NewsRuntime = Awaited<ReturnType<typeof createNewsIntelligenceRuntime>>;
export interface NewsHostRuntime {
  /** Independent, non-overlapping work; callers need not await it. */
  tick(): Promise<void>;
  suspend(): void;
  resume(): void;
  dispose(): void;
}

/** Main-only collector. Owns a connection to the EXISTING main database until work settles. */
export function createNewsHostRuntime(input: { readonly profileId: string; readonly databasePath: string;
  readonly quotaDatabasePath: string; readonly hostId: string; readonly clock: Clock;
  readonly configuration?: NewsHostConfiguration; readonly secrets?: SecretStore;
  readonly fetch?: FetchLike; readonly rateLimiters?: RateLimiterRegistry;
  readonly onUnexpectedError?: (context: string, error: unknown) => void }): NewsHostRuntime {
  if (input.profileId === 'main' && resolve(input.databasePath) !== resolve(input.quotaDatabasePath)) {
    throw new TypeError('Main news storage and quota authority must use the same database.');
  }
  const override = input.configuration === undefined ? null : validateNewsHostConfiguration(input.configuration);
  let disposed = false, suspended = false, pending: Promise<void> | null = null;
  let collector: NewsRuntime | null = null;
  let database: ReturnType<typeof openDatabase> | null = null;
  let generation = 0;
  const active = () => !disposed && !suspended && input.profileId === 'main' && database !== null &&
    isAuthoritativeHost('main', input.hostId, database);
  const release = () => { collector?.destroy(); collector = null; database?.close(); database = null; };
  const pause = () => {
    generation += 1; collector?.destroy();
    if (pending === null) release();
  };
  return {
    tick() {
      if (disposed || suspended || input.profileId !== 'main') return Promise.resolve();
      if (pending !== null) return pending;
      const currentGeneration = generation;
      pending = (async () => {
        try {
          database ??= openDatabase(input.quotaDatabasePath);
          if (!active()) { pause(); return; }
          const configuration = override ?? readNewsHostConfiguration(database);
          if (!configuration.gdeltEnabled) { pause(); return; }
          if (collector === null) {
            collector = await createNewsIntelligenceRuntime({ quotaDatabase: database, storageDatabase: database,
              clock: input.clock, secrets: input.secrets ?? createMemorySecretStore(), ownerId: input.hostId,
              enabledProviders: ['gdelt'], retentionPermissions: { gdelt: true, marketaux: false, currents: false },
              startCurrentSlot: true, canCollect: active,
              ...(input.fetch ? { fetch: input.fetch } : {}), ...(input.rateLimiters ? { rateLimiters: input.rateLimiters } : {}) });
          }
          if (currentGeneration !== generation || !active()) { pause(); return; }
          await collector.tick();
          if (!active()) pause();
        } catch {
          pause();
          if (!disposed) input.onUnexpectedError?.('news_host_tick', new Error('News collector failed.'));
        }
      })().finally(() => {
        pending = null;
        if (currentGeneration !== generation || disposed || suspended) release();
      });
      return pending;
    },
    suspend() { suspended = true; pause(); },
    resume() { if (!disposed) suspended = false; },
    dispose() { if (disposed) return; disposed = true; pause(); },
  };
}

/** Keep the synchronous application composition root small; initialization remains lazy. */
export function createRuntimeNewsHost(options: { readonly profileId: string; readonly databasePath: string;
  readonly newsQuotaDatabasePath?: string; readonly newsConfiguration?: NewsHostConfiguration },
  clock: Clock, hostId: string, report: (context: string, error: unknown) => void): NewsHostRuntime {
  return createNewsHostRuntime({ profileId: options.profileId, databasePath: options.databasePath,
    quotaDatabasePath: options.newsQuotaDatabasePath ?? options.databasePath, hostId, clock,
    ...(options.newsConfiguration === undefined ? {} : { configuration: options.newsConfiguration }), onUnexpectedError: report });
}
