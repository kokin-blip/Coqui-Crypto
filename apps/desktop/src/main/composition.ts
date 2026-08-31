import { randomUUID } from 'node:crypto';

import {
  createCoinbasePriceSource,
  createCoinGeckoDemoHttpClient,
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
  planAutoRebalance,
  calculatePaperPerformance,
  deriveFifoPaperLots,
  sha256Hex,
  type Clock,
  type ExecutionIntent,
} from '@coqui/core';
import {
  AccountSettingsService,
  AlertsService,
  PortfolioReadModelService,
  PortfolioTaxService,
  PaperExecutionService,
  ReconciliationLedgerService,
  paperPortfolioView,
  MarketDisplayQueryService,
  type PricedHolding,
  ResearchReadModelService,
  ResearchScoreboardService,
  RiskDashboardService,
  RiskEvidenceTrackerService,
  resolveKillSwitch,
  StatusRailService,
} from '@coqui/services';
import {
  getAllocationPolicy,
  getLatestPaperExecutionReview,
  getPaperDailyValuationEvidence,
  getPaperExecutionPolicy,
  getPaperExecutionProposal,
  getSetting,
  listActivityFeed,
  listRuntimeIncidents,
  listCoinbaseBalanceDiscrepancies,
  listDisplayUniverse,
  listForwardEdgeObservations,
  listPaperExecutionProposals,
  listPaperDailyValuationEvidence,
  listPaperFillPerformanceFacts,
  listPaperPerformanceDayFacts,
  openDatabase,
  readForwardEdgeStudyStatus,
  readProfitabilityEstimateEvidence,
  registerForwardEdgeStudy,
  setPaperExecutionPolicy,
  type Db,
} from '@coqui/storage';

import { createDiagnostics } from './diagnostics.js';
import { createChartSnapshotHandlers } from './chart-snapshot-handlers.js';
import { createChartWorkspaceHandlers } from './chart-workspace-handlers.js';
import { createChartExtensionHandlers } from './chart-extension-handlers.js';
import { createAccountPreferenceHandlers } from './account-preference-handlers.js';
import { CoinbaseMarketStreamService } from './coinbase-market-stream.js';
import { createMarketHandlers } from './market-handlers.js';
import { SHIPPED_FORWARD_EDGE_PLAN } from './forward-edge-plan.js';
import {
  captureScheduledForwardEvidence,
} from './forward-edge-runtime.js';
import { createAlertNotificationPump } from './notifications.js';
import { createPaperMarketFeed } from './paper-market.js';
import { createPaperCampaignHandlers } from './paper-campaign-handlers.js';
import { createCandleSource, createDisplayDataService, createReferenceSources } from './reference-sources.js';
import { startSchedulerRuntime, type SchedulerRuntime } from './scheduler-runtime.js';
import type { ChannelHandlers } from './dispatch.js';

/** Only an integrity-verified passing forward result can supply execution edge. */
function paperGrossEdgeLowerBoundPct(profileId: string, database: Db): number {
  return readProfitabilityEstimateEvidence(profileId, database)?.grossEdgeLowerBoundPct ?? 0;
}

/** Epoch of the last Coinbase sync, or null when never run or unparseable. */
function lastCoinbaseSyncAtMs(database: Db): number | null {
  const raw = getSetting('coinbase.last_sync_at', database);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function paperProposalView(
  proposal: ReturnType<typeof getPaperExecutionProposal> & {},
  database: Db,
) {
  const intents = JSON.parse(proposal.intentsJson) as readonly ExecutionIntent[];
  return {
    id: proposal.id,
    runId: proposal.runId,
    revision: proposal.revision,
    proposalHash: proposal.proposalHash,
    status: proposal.status,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    actions: intents.map((intent) => ({
      productId: intent.asset.instrument.productId,
      side: intent.side,
      amountUsd: String(intent.amountUsd),
      origin: 'rebalance' as const,
    })),
    review: getLatestPaperExecutionReview(proposal.id, database),
  };
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
  /**
   * A verified CoinGecko Demo key, read from the secret store *before* the
   * runtime is built.
   *
   * Passed in rather than read here so the key's only journey is
   * keychain → this argument → an HTTP client's header. The composition root
   * never holds a secret store, so there is no path by which a secret could
   * reach a service or a channel (invariant 3).
   */
  readonly coinGeckoApiKey?: string | null;
  /**
   * Delivers OS notifications. Injected because `electron.Notification` is
   * unavailable under vitest, and because whether to notify must be decidable
   * without an OS.
   */
  readonly notifier?: Parameters<typeof createAlertNotificationPump>[0]['notifier'];
  /** Native shell save boundary. Paths never return to the renderer or diagnostics. */
  readonly saveChartSnapshot?: (filenameStem: string, png: Uint8Array) => Promise<'saved' | 'cancelled'>;
}

export interface CoquiRuntime {
  readonly handlers: ChannelHandlers;
  /** Every background failure lands here first (`diagnostics.ts`). */
  readonly report: (context: string, error: unknown) => void;
  readonly database: Db;
  readonly clock: Clock;
  /** Null when the scheduler is disabled. Exposed so a test can drive a tick. */
  readonly scheduler: SchedulerRuntime | null;
  /** Start after a prepared profile becomes authoritative. Idempotent. */
  startScheduler(): void;
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
  const clock = new SystemClock(options.readSystemTime ?? (() => Date.now())), database = openDatabase(options.databasePath), forwardPlanHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, database);

  // Every background failure in the application goes through here: a structured
  // log line always, and an incident row when the fault is durable. Before this,
  // `createStructuredLogger` had no production caller and nothing but the
  // reconciliation harness ever wrote an incident.
  const diagnostics = createDiagnostics({
    database,
    clock,
    profileId: options.profileId,
    ...(options.coinGeckoApiKey === undefined || options.coinGeckoApiKey === null
      ? {}
      : { secrets: [options.coinGeckoApiKey] }),
  });
  const report = (context: string, error: unknown): void => {
    diagnostics.report(context, error);
    options.onUnexpectedError?.(context, error);
  };

  // One client over one shared registry. `createHttpClient` derives the hostname
  // and takes its budget from `forDomain`, so per-host
  // scoping is already handled; separate clients would only make it possible
  // for two of them to disagree about the same provider's limit.
  const rateLimiters = createRateLimiterRegistry();
  const http: HttpClient = createHttpClient({ rateLimiters });

  // The authenticated tier when a key is connected, the public tier otherwise.
  // Both share the rate-limiter registry: the Demo tier has a *higher* budget,
  // not an unlimited one, and two registries could disagree about the same host.
  const coinGeckoHttp: HttpClient =
    options.coinGeckoApiKey === undefined || options.coinGeckoApiKey === null
      ? http
      : createCoinGeckoDemoHttpClient(options.coinGeckoApiKey, { rateLimiters });

  // Coinbase is the venue and therefore the authoritative spot source;
  // CoinGecko fills only what Coinbase does not price. The order matters —
  // reversing it would let a reference price shadow a venue-reported one.
  const trackedAssets = () => listDisplayUniverse(options.profileId, database);
  const priceSource = withPriceFallback(
    createCoinbasePriceSource(http),
    createCoinGeckoPriceSource(coinGeckoHttp, trackedAssets()),
  );
  const portfolio = new PortfolioReadModelService({ database, clock, priceSource });

  const candles = createCandleSource(http);
  const marketData = new MarketDisplayQueryService({
    clock,
    sources: createReferenceSources({
      coingecko: coinGeckoHttp,
      coinbase: http,
      fearGreed: http,
      yields: http,
      news: http,
      trackedAssets,
    }),
    candles,
  });
  const displayData = createDisplayDataService({
    http, database, profileId: options.profileId, nowMs: () => clock.nowMs(),
  });
  const liveMarket = new CoinbaseMarketStreamService({ nowMs: () => clock.nowMs(), onUnexpectedError: report });

  // PortfolioAllocationPolicyService is deliberately not wired: it only offers
  // savePolicy/clearPolicy, and there are no write channels before P6.
  const tax = new PortfolioTaxService({ database, clock }), reconciliation = new ReconciliationLedgerService({ database, clock }), settings = new AccountSettingsService({ database, clock });

  const research = new ResearchReadModelService({ database }), scoreboard = new ResearchScoreboardService({ database });
  const evidence = new RiskEvidenceTrackerService({ database, clock });
  const alerts = new AlertsService({
    database,
    clock,
    idSource: { nextId: () => randomUUID() },
  });
  const riskDashboard = new RiskDashboardService({ database, clock });
  const statusRail = new StatusRailService({ database, clock });

  // The paper engine. Its decision is synchronous, so the two things it needs
  // from the outside world — market data and a holdings snapshot — are
  // refreshed before each tick rather than awaited inside one.
  const paperMarket = createPaperMarketFeed({
    database,
    http,
    instruments: () => getAllocationPolicy(database).targets.map((target) => target.instrument),
    bars: (instrument, lookbackDays, nowMs) => candles.dailyBars(instrument, lookbackDays, nowMs),
    onUnexpectedError: report,
  });

  const notifications = options.notifier === undefined
    ? null
    : createAlertNotificationPump({
        alerts,
        notifier: options.notifier,
        profileId: options.profileId,
        onUnexpectedError: report,
      });

  let paperHoldings: readonly PricedHolding[] = [];
  const paperExecution = () => new PaperExecutionService({
    database,
    profileId: options.profileId,
    nowMs: () => clock.nowMs(),
    market: paperMarket.view,
    state: () => ({
      holdings: paperHoldings,
      killSwitchEngaged: resolveKillSwitch(options.profileId, database).engaged,
      evidenceVerified: evidence.track().conversationEligible,
      historicalGrossEdgeLowerBoundPct: paperGrossEdgeLowerBoundPct(options.profileId, database),
    }),
    onUnexpectedError: report,
  });
  let scheduler: SchedulerRuntime | null = null, disposed = false;
  const startScheduler = (): void => {
    if (disposed || scheduler !== null) return;
    liveMarket.start(trackedAssets().map((asset) => asset.instrument.productId));
    scheduler = startSchedulerRuntime({
        database,
        clock,
        profileId: options.profileId,
        onUnexpectedError: report,
        async prepare(nowMs) {
          await paperMarket.refresh(nowMs);
          paperHoldings = (await portfolio.portfolioView()).holdings;
          // After the refresh, so an alert raised by this tick's data is
          // delivered by this tick rather than waiting for the next one.
          notifications?.deliver(nowMs);
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
          historicalGrossEdgeLowerBoundPct: paperGrossEdgeLowerBoundPct(options.profileId, database),
          evidenceVerified: () => evidence.track().conversationEligible,
          captureEvidence: async (summary) => {
            await captureScheduledForwardEvidence({
              profileId: options.profileId,
              plan: SHIPPED_FORWARD_EDGE_PLAN,
              planHash: forwardPlanHash,
              summary,
              clock,
              priceSource,
              market: paperMarket.view,
              database,
            });
          },
          onUnexpectedError: report,
        },
      });
  };
  if (options.disableScheduler !== true) startScheduler();

  const handlers: ChannelHandlers = {
    ...createChartExtensionHandlers({ profileId: options.profileId, database, clock }),
    ...createChartSnapshotHandlers({ profileId: options.profileId, database, clock, ...(options.saveChartSnapshot === undefined ? {} : { save: options.saveChartSnapshot }) }),
    ...createChartWorkspaceHandlers({ profileId: options.profileId, database, clock }),
    ...createPaperCampaignHandlers(options.profileId, clock, database),
    'activity.feed': (payload: { readonly limit: number; readonly cursor: string | null }) => ({
      ok: true,
      value: {
        ...listActivityFeed(options.profileId, payload.limit, payload.cursor, database),
        asOfMs: clock.nowMs(),
      },
    }),
    'paper.performance': () => {
      const valuations = listPaperDailyValuationEvidence(options.profileId, database);
      const fills = listPaperFillPerformanceFacts(options.profileId, database);
      const fifo = deriveFifoPaperLots(fills);
      return {
        ok: true,
        value: {
          ...calculatePaperPerformance({
            valuations: valuations.map((item) => ({
              dayUtc: item.dayUtc,
              equityUsd: item.equityUsd,
              benchmarkUsd: item.benchmarkUsd,
              evidenceHash: item.evidenceHash,
              unpricedCount: item.unpricedCount,
            })),
            closedLots: fifo.closedLots,
            costs: fills,
            unattributedOpeningBalance: fifo.unattributedOpeningBalanceExcluded,
          }),
          benchmarkStatus: valuations.some((item) => item.benchmarkUsd !== null)
            ? 'available' as const
            : 'unavailable_starting_evidence' as const,
        },
      };
    },
    'paper.performance-day': (payload: { readonly dayUtc: number }) => {
      const evidence = getPaperDailyValuationEvidence(options.profileId, payload.dayUtc, database);
      const facts = listPaperPerformanceDayFacts(options.profileId, payload.dayUtc, database);
      return {
        ok: true,
        value: {
          dayUtc: payload.dayUtc,
          evidence: evidence === null ? null : {
            capturedAt: evidence.capturedAt,
            cashUsd: evidence.cashUsd,
            equityUsd: evidence.equityUsd,
            benchmarkUsd: evidence.benchmarkUsd,
            unpricedCount: evidence.unpricedCount,
            evidenceHash: evidence.evidenceHash,
            provenanceJson: evidence.provenanceJson,
          },
          fills: facts.fills,
          transitions: facts.transitions,
        },
      };
    },
    'paper.execution.policy': () => ({
      ok: true,
      value: getPaperExecutionPolicy(options.profileId, database),
    }),
    'paper.execution.policy.set': (payload: {
      readonly commandId: string;
      readonly mode: 'off' | 'review_required' | 'unattended';
      readonly explicitUnattendedConfirmation: boolean;
    }) => {
      if (payload.mode === 'unattended' && !payload.explicitUnattendedConfirmation) {
        return { ok: false, issues: [{ code: 'unattended_confirmation_required' }] };
      }
      return {
        ok: true,
        value: setPaperExecutionPolicy({
          ...payload,
          profileId: options.profileId,
          confirmedAt: clock.nowMs(),
        }, database),
      };
    },
    'paper.execution.proposals': (payload: { readonly limit: number }) => ({
      ok: true,
      value: {
        proposals: listPaperExecutionProposals(options.profileId, payload.limit, database)
          .map((proposal) => paperProposalView(proposal, database)),
      },
    }),
    'paper.execution.proposal': (payload: { readonly proposalId: string }) => {
      const proposal = getPaperExecutionProposal(payload.proposalId, database);
      return proposal === null
        ? { ok: false, issues: [{ code: 'proposal_not_found' }] }
        : { ok: true, value: paperProposalView(proposal, database) };
    },
    'paper.execution.prepare': async (payload: { readonly commandId: string }) => {
      const now = clock.nowMs();
      await paperMarket.refresh(now);
      paperHoldings = (await portfolio.portfolioView()).holdings;
      const policy = getAllocationPolicy(database);
      const intents = policy.targets.length === 0
        ? []
        : planAutoRebalance(paperHoldings, policy, now);
      const runId = sha256Hex(`paper-ui:${options.profileId}:${payload.commandId}`);
      return {
        ok: true,
        value: paperExecution().prepare({
          proposalId: sha256Hex(`paper-proposal:${runId}:1`),
          runId,
          revision: 1,
          intents,
        }),
      };
    },
    'paper.execution.review': async (payload: {
      readonly commandId: string;
      readonly proposalId: string;
      readonly proposalHash: string;
      readonly decision: 'approve' | 'reject';
      readonly reviewer: string;
      readonly note: string;
    }) => {
      const now = clock.nowMs();
      await paperMarket.refresh(now);
      paperHoldings = (await portfolio.portfolioView()).holdings;
      return { ok: true, value: paperExecution().review(payload) };
    },
    ...createMarketHandlers(marketData, displayData, liveMarket),
    'research.runs': () => research.runs(),
    'research.performance': () => research.performance(),
    'research.edge-study': () => {
      const status = readForwardEdgeStudyStatus(database);
      const observations = status.planHash === null ? []
        : listForwardEdgeObservations(status.planHash, options.profileId, database);
      const completedDays = observations.filter((item) => item.valuationComplete).length;
      const costBearingRebalances = observations.filter((item) => Number(item.turnoverUsd) > 0).length;
      const outcome = status.result?.outcome ?? 'not_registered';
      return { ok: true, value: {
        status: status.plan === null ? 'not_registered' : outcome === 'not_registered' ? 'collecting' : outcome,
        planHash: status.planHash,
        costProfileHash: status.plan?.costProfileHash ?? null,
        resultHash: status.resultHash,
        registeredAtMs: status.plan?.registeredAtMs ?? null,
        firstEligibleDayUtcMs: status.plan?.firstEligibleDayUtcMs ?? null,
        completedDays: status.result?.completedDays ?? completedDays,
        minimumCompletedDays: 365 as const,
        costBearingRebalances: status.result?.costBearingRebalances ?? costBearingRebalances,
        minimumCostBearingRebalances: 30 as const,
        trialUpperBound: 215 as const,
        grossEdgeLowerBoundPct: status.result?.grossEdgeLowerConfidenceBoundPct ?? null,
        netEdgeLowerBoundPct: status.result?.netEdgeLowerConfidenceBoundPct ?? null,
        sourceHashes: status.result?.sourceHashes ?? [],
        outcome,
        activated: status.activated,
      } };
    },
    'research.jobs': (payload: { readonly limit: number }) => research.jobs(payload.limit),
    'research.job': (payload: { readonly id: string }) => research.job(payload.id),
    'portfolio.view': async () => ({ ok: true, value: await portfolio.portfolioView() }),
    'portfolio.reconciliation': () => {
      const ledger = reconciliation.view(options.profileId);
      return {
        ok: true,
        value: {
          discrepancies: listCoinbaseBalanceDiscrepancies(database, 250),
          // Same source the status rail reads, so the two cannot disagree about
          // when reconciliation last ran.
          lastRunAtMs: lastCoinbaseSyncAtMs(database),
          exceptions: ledger.exceptions,
          unresolvedCount: ledger.unresolvedCount,
          options: ledger.options,
        },
      };
    },
    'portfolio.reconciliation.resolve': (payload: {
      readonly commandId: string;
      readonly discrepancyId: string;
      readonly kind: Parameters<ReconciliationLedgerService['resolve']>[0]['kind'];
      readonly linkedLotId: string | null;
      readonly note: string;
    }) => {
      const result = reconciliation.resolve({
        profileId: options.profileId,
        discrepancyId: payload.discrepancyId,
        kind: payload.kind,
        linkedLotId: payload.linkedLotId,
        note: payload.note,
      });
      // A refusal is `blocked`, not `failed`: nothing went wrong, a rule
      // declined. The four-way outcome exists so the surface can tell those
      // apart rather than showing an error for a correct refusal.
      // The dispatcher classifies the code into the four-way outcome, so a
      // rule refusal and a malformed request are told apart at the boundary
      // rather than by each surface.
      return result.ok
        ? { ok: true, value: { resolution: result.resolution } }
        : { ok: false, issues: [{ code: result.code }] };
    },
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
    'paper.portfolio': async () => ({
      ok: true,
      // Priced with the same source as the real portfolio, so the two figures
      // are comparable rather than differing partly by data.
      value: await paperPortfolioView(
        { database, clock, priceSource },
        options.profileId,
      ),
    }),
    ...createAccountPreferenceHandlers(options.profileId, settings),
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
    // Derived on every read from the equity history. There is no setter, here
    // or anywhere: a stage the user could set is a guardrail they could disable.
    'risk.dashboard': () => ({ ok: true, value: riskDashboard.view() }),
    // Append-only by construction; a resolution is a later row, never an edit.
    'app.incidents': (payload: { readonly limit: number }) => ({
      ok: true,
      value: {
        incidents: listRuntimeIncidents(options.profileId, false, payload.limit, database),
        asOfMs: clock.nowMs(),
      },
    }),
    'alerts.view': () => ({
      ok: true,
      value: alerts.view(options.profileId),
    }),
    'app.status-rail': () => statusRail.status(options.profileId),
  } as ChannelHandlers;

  return {
    handlers,
    report,
    database,
    clock,
    get scheduler() { return scheduler; },
    startScheduler,
    dispose() {
      if (disposed) return;
      disposed = true;
      scheduler?.dispose();
      liveMarket.dispose();
      if (coinGeckoHttp !== http) coinGeckoHttp.destroy();
      http.destroy();
      rateLimiters.destroyAll();
      database.close();
    },
  };
}
