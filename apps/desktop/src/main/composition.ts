import {
  createHttpClient,
  createRateLimiterRegistry,
  type HttpClient,
} from '@coqui/adapters';
import { SystemClock, type Clock } from '@coqui/core';
import {
  MarketDisplayQueryService,
  ResearchReadModelService,
  ResearchScoreboardService,
  RiskEvidenceTrackerService,
  StatusRailService,
} from '@coqui/services';
import { listDisplayUniverse, openDatabase, type Db } from '@coqui/storage';

import { createCandleSource, createReferenceSources } from './reference-sources.js';
import type { ChannelHandlers } from './dispatch.js';

export interface RuntimeOptions {
  readonly databasePath: string;
  readonly profileId: string;
  /** Supplied by the composition root so `core` never reads the host clock. */
  readonly readSystemTime?: () => number;
}

export interface CoquiRuntime {
  readonly handlers: ChannelHandlers;
  readonly database: Db;
  readonly clock: Clock;
  dispose(): void;
}

/**
 * Instantiate the application.
 *
 * This lives in the shell rather than in `packages/services` on purpose: the
 * `architecture/service-import-limit` lint rule caps a service at two
 * cross-service imports precisely so that cross-cutting wiring has to happen
 * at a composition root, where it is visible, instead of accumulating inside
 * whichever service happened to need it first.
 */
export function createRuntime(options: RuntimeOptions): CoquiRuntime {
  const clock = new SystemClock(options.readSystemTime ?? (() => Date.now()));
  const database = openDatabase(options.databasePath);

  // One client over one shared registry. `createHttpClient` derives the
  // hostname from each URL and takes its budget from `forDomain`, so per-host
  // scoping is already handled; separate clients would only make it possible
  // for two of them to disagree about the same provider's limit.
  const rateLimiters = createRateLimiterRegistry();
  const http: HttpClient = createHttpClient({ rateLimiters });

  const marketData = new MarketDisplayQueryService({
    clock,
    sources: createReferenceSources({
      coingecko: http,
      coinbase: http,
      fearGreed: http,
      yields: http,
      news: http,
      trackedAssets: () => listDisplayUniverse(options.profileId, database),
    }),
    candles: createCandleSource(http),
  });

  const research = new ResearchReadModelService({ database });
  const scoreboard = new ResearchScoreboardService({ database });
  const evidence = new RiskEvidenceTrackerService({ database, clock });
  const statusRail = new StatusRailService({ database, clock });

  const handlers: ChannelHandlers = {
    'market-data.prices': () => marketData.prices(),
    'market-data.markets': () => marketData.markets(),
    'market-data.fear-greed': () => marketData.fearGreed(),
    'market-data.trending': () => marketData.trending(),
    'market-data.yields': () => marketData.yields(),
    'market-data.news': (payload: { readonly limit: number }) => marketData.news(payload.limit),
    'market-data.candles': (payload: {
      readonly instrument: Parameters<MarketDisplayQueryService['candles']>[0];
      readonly lookbackDays: number;
    }) => marketData.candles(payload.instrument, payload.lookbackDays),
    'research.runs': () => research.runs(),
    'research.jobs': (payload: { readonly limit: number }) => research.jobs(payload.limit),
    'research.job': (payload: { readonly id: string }) => research.job(payload.id),
    'research.scoreboard': () => scoreboard.latest(),
    // The tracker throws only on a broken clock; the dispatcher contains that
    // and reports a stable code rather than letting it cross IPC.
    'risk.evidence-gate': () => ({ ok: true, value: evidence.track() }),
    'app.status-rail': (payload: { readonly profileId: string }) =>
      statusRail.status(payload.profileId),
  } as ChannelHandlers;

  return {
    handlers,
    database,
    clock,
    dispose() {
      http.destroy();
      rateLimiters.destroyAll();
      database.close();
    },
  };
}
