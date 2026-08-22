import {
  createCoinbasePriceSource,
  createCoinGeckoPriceSource,
  createHttpClient,
  createRateLimiterRegistry,
  withPriceFallback,
  type HttpClient,
} from '@coqui/adapters';
import {
  SystemClock,
  NEGATIVE_FINDINGS,
  NEGATIVE_FINDING_LEDGER_NOTE,
  type Clock,
} from '@coqui/core';
import {
  AccountSettingsService,
  PortfolioReadModelService,
  PortfolioTaxService,
  paperPortfolioView,
  MarketDisplayQueryService,
  type PricedHolding,
  ResearchReadModelService,
  ResearchScoreboardService,
  RiskEvidenceTrackerService,
  StatusRailService,
} from '@coqui/services';
import {
  getAllocationPolicy,
  getSetting,
  listCoinbaseBalanceDiscrepancies,
  listDisplayUniverse,
  openDatabase,
  type Db,
} from '@coqui/storage';

import { createPaperMarketFeed } from './paper-market.js';
import { createCandleSource, createReferenceSources } from './reference-sources.js';
import { startSchedulerRuntime, type SchedulerRuntime } from './scheduler-runtime.js';
import type { ChannelHandlers } from './dispatch.js';

/**
 * The per-trade net edge the profitability gate weighs costs against.
 *
 * **Zero by default, deliberately.** No study in this repository has registered
 * a per-trade net-edge estimate for the shipped strategy — its own version
 * string is `trendvol-legacy-unvalidated` — and inventing one would be exactly
 * the false confidence invariant 4 exists to prevent. At zero the gate refuses
 * every intent and the run stands down as `gates_refused`, which the portfolio
 * screen states in plain words rather than hiding.
 *
 * The setting exists so that a *registered* estimate can be supplied once one
 * exists (invariant 7), not as a knob to make the engine trade.
 */
function paperNetEdgeEstimatePct(database: Db): number {
  const raw = getSetting('paper.net_edge_estimate_pct', database);
  if (raw === null) return 0;
  const parsed = Number(raw);
  // A malformed value falls back to the refusing default, never to a guess.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Epoch of the last Coinbase sync, or null when never run or unparseable. */
function lastCoinbaseSyncAtMs(database: Db): number | null {
  const raw = getSetting('coinbase.last_sync_at', database);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface RuntimeOptions {
  readonly databasePath: string;
  readonly profileId: string;
  /** Supplied by the composition root so `core` never reads the host clock. */
  readonly readSystemTime?: () => number;
  /** Reported rather than thrown, so one bad tick cannot take down the app. */
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
  /**
   * Leave the paper scheduler stopped. The smoke harness boots the runtime to
   * check wiring and should not start a timer or reach the network to do it.
   */
  readonly disableScheduler?: boolean;
}

export interface CoquiRuntime {
  readonly handlers: ChannelHandlers;
  readonly database: Db;
  readonly clock: Clock;
  /** Null when the scheduler is disabled. Exposed so a test can drive a tick. */
  readonly scheduler: SchedulerRuntime | null;
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

  // Coinbase is the venue and therefore the authoritative spot source;
  // CoinGecko fills only what Coinbase does not price. The order matters —
  // reversing it would let a reference price shadow a venue-reported one.
  const trackedAssets = () => listDisplayUniverse(options.profileId, database);
  const priceSource = withPriceFallback(
    createCoinbasePriceSource(http),
    createCoinGeckoPriceSource(http, trackedAssets()),
  );
  const portfolio = new PortfolioReadModelService({ database, clock, priceSource });

  const candles = createCandleSource(http);
  const marketData = new MarketDisplayQueryService({
    clock,
    sources: createReferenceSources({
      coingecko: http,
      coinbase: http,
      fearGreed: http,
      yields: http,
      news: http,
      trackedAssets,
    }),
    candles,
  });

  // PortfolioAllocationPolicyService is deliberately not wired: it only offers
  // savePolicy/clearPolicy, and there are no write channels before P6.
  const tax = new PortfolioTaxService({ database, clock });
  const settings = new AccountSettingsService({ database, clock });

  const research = new ResearchReadModelService({ database });
  const scoreboard = new ResearchScoreboardService({ database });
  const evidence = new RiskEvidenceTrackerService({ database, clock });
  const statusRail = new StatusRailService({ database, clock });

  // The paper engine. Its decision is synchronous, so the two things it needs
  // from the outside world — market data and a holdings snapshot — are
  // refreshed before each tick rather than awaited inside one.
  const paperMarket = createPaperMarketFeed({
    database,
    http,
    instruments: () => getAllocationPolicy(database).targets.map((target) => target.instrument),
    bars: (instrument, lookbackDays, nowMs) => candles.dailyBars(instrument, lookbackDays, nowMs),
    ...(options.onUnexpectedError === undefined
      ? {}
      : { onUnexpectedError: options.onUnexpectedError }),
  });

  let paperHoldings: readonly PricedHolding[] = [];
  const scheduler = options.disableScheduler === true
    ? null
    : startSchedulerRuntime({
        database,
        clock,
        profileId: options.profileId,
        ...(options.onUnexpectedError === undefined
          ? {}
          : { onUnexpectedError: options.onUnexpectedError }),
        async prepare(nowMs) {
          await paperMarket.refresh(nowMs);
          paperHoldings = (await portfolio.portfolioView()).holdings;
        },
        paper: {
          database,
          clock,
          profileId: options.profileId,
          market: paperMarket.view,
          holdings: () => paperHoldings,
          // Empty targets mean no policy: `planAutoRebalance` against nothing
          // would propose selling the whole portfolio.
          policy: () => {
            const policy = getAllocationPolicy(database);
            return policy.targets.length === 0 ? null : policy;
          },
          historicalNetEdgeEstimatePct: paperNetEdgeEstimatePct(database),
          ...(options.onUnexpectedError === undefined
            ? {}
            : { onUnexpectedError: options.onUnexpectedError }),
        },
      });

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
    'portfolio.view': async () => ({ ok: true, value: await portfolio.portfolioView() }),
    'portfolio.reconciliation': () => ({
      ok: true,
      value: {
        // Read-only in P5. The rows are immutable by trigger (migration 42) and
        // resolution needs its own append-only table — that arrives with P7's
        // single reconciliation ledger, so it is built once rather than twice.
        discrepancies: listCoinbaseBalanceDiscrepancies(database, 250),
        // Same source the status rail reads, so the two cannot disagree about
        // when reconciliation last ran.
        lastRunAtMs: lastCoinbaseSyncAtMs(database),
      },
    }),
    'portfolio.allocation': async () => {
      // allocationView also embeds the whole priced portfolio, which
      // portfolio.view already carries. Both channels poll at 60s, so shipping
      // it twice would double the payload for a screen that does not read it.
      const view = await portfolio.allocationView();
      return {
        ok: true,
        value: {
          policy: view.policy,
          allocation: view.allocation,
          plan: view.plan,
          planStatus: view.planStatus,
        },
      };
    },
    'portfolio.tax': () => ({ ok: true, value: tax.view() }),
    'paper.portfolio': async (payload: { readonly profileId: string }) => ({
      ok: true,
      // Priced with the same source as the real portfolio, so the two figures
      // are comparable rather than differing partly by data.
      value: await paperPortfolioView(
        { database, clock, priceSource },
        payload.profileId,
      ),
    }),
    'accounts.settings': (payload: { readonly profileId: string }) =>
      settings.get(payload.profileId),
    'research.scoreboard': () => scoreboard.latest(),
    // Static, frozen core data — there is no service to fail, so this cannot
    // return anything but ok.
    'research.negative-findings': () => ({
      ok: true,
      value: { findings: NEGATIVE_FINDINGS, ledgerNote: NEGATIVE_FINDING_LEDGER_NOTE },
    }),
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
    scheduler,
    dispose() {
      scheduler?.dispose();
      http.destroy();
      rateLimiters.destroyAll();
      database.close();
    },
  };
}
