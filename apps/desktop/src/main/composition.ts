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
} from '@coqui/core';
import {
  AccountSettingsService,
  type CoinbaseEvidenceAcquirer,
  type CoinbaseCredentialVerifier,
  AlertsService,
  PortfolioReadModelService,
  PortfolioTaxService,
  PaperExecutionService,
  ExploratoryPaperCampaignService,
  ReconciliationLedgerService,
  paperPortfolioView,
  MarketDisplayQueryService,
  type PricedHolding,
  ResearchReadModelService,
  ResearchScoreboardService,
  ResearchHostCoordinator,
  type RegisteredResearchDefinitionV1,
  RiskDashboardService,
  RiskEvidenceTrackerService,
  ProfileReadinessService,
  resolveKillSwitch,
  StatusRailService,
} from '@coqui/services';
import {
  getAllocationPolicy, isAuthoritativeHost,
  getPaperDailyValuationEvidence,
  getPaperExecutionPolicy,
  getPaperExecutionProposal,
  listActivityFeed,
  listRuntimeIncidents,
  listCoinbaseBalanceDiscrepancies,
  listDisplayUniverse,
  listPaperExecutionProposals,
  listPaperDailyValuationEvidence,
  listPaperFillPerformanceFacts,
  listPaperPerformanceDayFacts,
  openDatabase,
  readProfitabilityEstimateEvidence, readOperationsFloor, listResearchLineage,
  registerForwardEdgeStudy,
  setPaperExecutionPolicy,
  type Db,
} from '@coqui/storage';

import { createDiagnostics } from './diagnostics.js';
import { createExploratoryPaperRuntime } from './exploratory-paper-handlers.js';
import { createDecisionHandlers } from './decision-handlers.js';
import { createAdvisorHandlers } from './advisor-handlers.js';
import { createChartExtensionHandlers, createChartSnapshotHandlers, createChartWorkspaceHandlers } from './chart-handler-factories.js';
import { createAccountPreferenceHandlers } from './account-preference-handlers.js';
import { CoinbaseMarketStreamService } from './coinbase-market-stream.js';
import { createCoinbaseSyncHandlers, lastCoinbaseSyncAtMs } from './coinbase-handlers.js';
import { createConnectionHandlers, type ConnectionFileSelection } from './connection-handlers.js';
import { createAlpacaPaperHandlers } from './alpaca-paper-handlers.js';
import { createParallelPaperHandlers } from './parallel-paper-handlers.js';
import { createParallelPaperRuntime } from './parallel-paper-runtime.js';
import { createMarketHandlers } from './market-handlers.js'; import { createMarketEventHandlers } from './market-event-handlers.js';
import { createResearchOrchestrationHandlers } from './research-handlers.js';
import { SHIPPED_FORWARD_EDGE_PLAN } from './forward-edge-plan.js';
import { captureScheduledForwardEvidence, readForwardEdgeStatus } from './forward-edge-runtime.js';
import { createAlertNotificationPump } from './notifications.js';
import { createPaperMarketFeed } from './paper-market.js';
import { paperInstruments as resolvePaperInstruments } from './paper-instruments.js';
import { createPaperCampaignHandlers } from './paper-campaign-handlers.js';
import { paperProposalView } from './paper-proposal-view.js';
import { createCandleSource, createDisplayDataService, createReferenceSources } from './reference-sources.js';
import { startSchedulerRuntime, type SchedulerRuntime } from './scheduler-runtime.js';
import type { ChannelHandlers } from './dispatch.js';
function paperGrossEdgeLowerBoundPct(profileId: string, database: Db): number | null {
  return readProfitabilityEstimateEvidence(profileId, database)?.grossEdgeLowerBoundPct ?? null;
}

export interface RuntimeOptions extends Partial<Pick<Parameters<typeof createAdvisorHandlers>[0], 'secrets' | 'saveHistory' |
  'readClipboardText' | 'clearClipboardIfMatches'>> {
  readonly databasePath: string; readonly profileId: string; readonly hostId?: string;
  readonly readSystemTime?: () => number;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
  /** Leave the scheduler stopped for smoke tests. */
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
  readonly coinbaseAcquirer?: CoinbaseEvidenceAcquirer; readonly coinbaseVerifier?: CoinbaseCredentialVerifier; readonly pickConnectionFile?: (provider: 'coinbase' | 'robinhood_crypto') => Promise<ConnectionFileSelection | null>;
  /**
   * Delivers OS notifications. Injected because `electron.Notification` is
   * unavailable under vitest, and because whether to notify must be decidable
   * without an OS.
   */
  readonly notifier?: Parameters<typeof createAlertNotificationPump>[0]['notifier'];
  readonly saveChartSnapshot?: (filenameStem: string, png: Uint8Array) => Promise<'saved' | 'cancelled'>; readonly pickChartExtension?: () => Promise<string | null>;
  readonly researchRegistrations?: readonly RegisteredResearchDefinitionV1[];
  readonly pickMarketEventFile?:()=>Promise<{readonly contents:string;readonly reference:string}|null>;
}
export interface CoquiRuntime {
  readonly handlers: ChannelHandlers;
  /** Every background failure lands here first (`diagnostics.ts`). */
  readonly report: (context: string, error: unknown) => void;
  readonly recordDeprecatedChannel: (channel: string) => void;
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
  const clock = new SystemClock(options.readSystemTime ?? (() => Date.now())), database = openDatabase(options.databasePath), forwardPlanHash = registerForwardEdgeStudy(SHIPPED_FORWARD_EDGE_PLAN, database), hostId = options.hostId ?? `desktop-${randomUUID()}`;

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
    diagnostics.report(context, error); options.onUnexpectedError?.(context, error);
  };

  // One client over one shared registry. `createHttpClient` derives the hostname
  // and takes its budget from `forDomain`, so per-host
  // scoping is already handled; separate clients would only make it possible
  // for two of them to disagree about the same provider's limit.
  const rateLimiters = createRateLimiterRegistry();
  const http: HttpClient = createHttpClient({ rateLimiters });

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

  const research = new ResearchReadModelService({ database,profileId:options.profileId }), scoreboard = new ResearchScoreboardService({ database });
  const researchHost = new ResearchHostCoordinator({ profileId: options.profileId, database, clock,
    ...(options.researchRegistrations===undefined?{}:{registrations:options.researchRegistrations}) });
  const evidence = new RiskEvidenceTrackerService({ database, clock });
  const alerts = new AlertsService({
    database,
    clock,
    idSource: { nextId: () => randomUUID() },
  });
  const riskDashboard = new RiskDashboardService({ database, clock });
  const statusRail = new StatusRailService({ database, clock });
  const profileReadiness = new ProfileReadinessService(database, clock);
  const exploratoryCampaigns = new ExploratoryPaperCampaignService(database);
  const paperInstruments = () => resolvePaperInstruments(options.profileId, database);

  // Market data and holdings are refreshed before each synchronous paper tick.
  const paperMarket = createPaperMarketFeed({
    database,
    http,
    instruments: paperInstruments,
    bars: (instrument, lookbackDays, nowMs) => candles.dailyBars(instrument, lookbackDays, nowMs),
    onUnexpectedError: report,
  });
  const parallel = createParallelPaperRuntime({ profileId: options.profileId, database, clock, http,
    bars: (instrument, lookbackDays, nowMs) => candles.dailyBars(instrument, lookbackDays, nowMs),
    onUnexpectedError: report, ...(options.secrets === undefined ? {} : { secrets: options.secrets }) });

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
    onUnexpectedError: report, executionOwnerId: hostId,
  });
  const paperRunDependencies = {
    database, clock, profileId: options.profileId, market: paperMarket.view,
    preparation: paperMarket.preparation, holdings: () => paperHoldings,
    policy: () => {
      const policy = getAllocationPolicy(database);
      return policy.targets.length === 0 ? null : policy;
    },
    historicalGrossEdgeLowerBoundPct: paperGrossEdgeLowerBoundPct(options.profileId, database),
    evidenceVerified: () => evidence.track().conversationEligible, executionOwnerId: hostId,
    captureEvidence: async (summary: Parameters<typeof captureScheduledForwardEvidence>[0]['summary']) => {
      await captureScheduledForwardEvidence({ profileId: options.profileId,
        plan: SHIPPED_FORWARD_EDGE_PLAN, planHash: forwardPlanHash, summary, clock,
        priceSource, market: paperMarket.view, database });
    },
    onUnexpectedError: report,
  };
  let scheduler: SchedulerRuntime | null = null, disposed = false;
  const startScheduler = (): void => {
    if (disposed || scheduler !== null) return;
    if (!isAuthoritativeHost(options.profileId, hostId, database)) return;
    liveMarket.start(paperInstruments().map((instrument) => instrument.productId));
    scheduler = startSchedulerRuntime({
        database,
        clock,
        profileId: options.profileId, hostId, onUnexpectedError: report, research: researchHost,
        async prepare(nowMs) {
          await paperMarket.refresh(nowMs);
          await parallel.refreshIfActive(nowMs);
          liveMarket.configure(paperInstruments().map((instrument) => instrument.productId));
          paperHoldings = (await portfolio.portfolioView()).holdings;
          // Deliver alerts raised by this refresh in the same tick.
          notifications?.deliver(nowMs);
        },
        paper: paperRunDependencies,
        parallelPaper: parallel.service,
      });
  };
  if (options.disableScheduler !== true) startScheduler();
  const exploratoryRuntime = createExploratoryPaperRuntime({ profileId: options.profileId,
    database, clock, market: paperMarket, campaigns: exploratoryCampaigns, run: paperRunDependencies });
  const handlers: ChannelHandlers = {
    ...createAlpacaPaperHandlers({ profileId: options.profileId, database, clock,
      onDisconnect: () => parallel.service.pauseForDisconnect(),
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }) }),
    ...createParallelPaperHandlers(parallel.service),
    ...createCoinbaseSyncHandlers({ profileId: options.profileId, database, clock, priceSource,
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      ...(options.coinbaseAcquirer === undefined ? {} : { acquirer: options.coinbaseAcquirer }),
    }),
    ...createConnectionHandlers({ profileId: options.profileId, database, clock, priceSource, ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      ...(options.pickConnectionFile === undefined ? {} : { pickConnectionFile: options.pickConnectionFile }), ...(options.coinbaseAcquirer === undefined ? {} : { coinbaseAcquirer: options.coinbaseAcquirer }),
      ...(options.coinbaseVerifier === undefined ? {} : { coinbaseVerifier: options.coinbaseVerifier }),
      ...(options.readClipboardText === undefined ? {} : { readClipboardText: options.readClipboardText }) }),
    ...createAdvisorHandlers({ profileId: options.profileId, database, clock, http,
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }), ...(options.saveHistory === undefined ? {} : { saveHistory: options.saveHistory }),
      ...(options.readClipboardText === undefined ? {} : { readClipboardText: options.readClipboardText }), ...(options.clearClipboardIfMatches === undefined ? {} : { clearClipboardIfMatches: options.clearClipboardIfMatches }) }),
    ...createChartExtensionHandlers({ profileId: options.profileId, database, clock, ...(options.pickChartExtension === undefined ? {} : { pickPackage: options.pickChartExtension }) }),
    ...createChartSnapshotHandlers({ profileId: options.profileId, database, clock, ...(options.saveChartSnapshot === undefined ? {} : { save: options.saveChartSnapshot }) }),
    ...createChartWorkspaceHandlers({ profileId: options.profileId, database, clock }),
    ...createPaperCampaignHandlers(options.profileId, clock, database),
    ...createMarketEventHandlers({ profileId: options.profileId, database, clock,
      requestResearch: (triggerId,at) => researchHost.request(triggerId,at),
      ...(options.pickMarketEventFile===undefined?{}:{pickEventFile:options.pickMarketEventFile}) }),
    ...createResearchOrchestrationHandlers({coordinator:researchHost,clock}),
    ...createDecisionHandlers(options.profileId, clock, database),
    ...exploratoryRuntime.handlers,
    'activity.feed': (payload: { readonly limit: number; readonly cursor: string | null }) => ({
      ok: true,
      value: {
        ...listActivityFeed(options.profileId, payload.limit, payload.cursor, database),
        asOfMs: clock.nowMs(),
      },
    }),
    'operations.floor': () => ({ ok: true, value: { asOfMs: clock.nowMs(), subsystems: readOperationsFloor(options.profileId, database) } }),
    'paper.performance': () => {
      const valuations = listPaperDailyValuationEvidence(options.profileId, database);
      const fills = listPaperFillPerformanceFacts(options.profileId, database);
      const fifo = deriveFifoPaperLots(fills);
      const performance = calculatePaperPerformance({
        valuations: valuations.map((item) => ({ dayUtc: item.dayUtc, equityUsd: item.equityUsd,
          benchmarkUsd: item.benchmarkUsd, evidenceHash: item.evidenceHash,
          unpricedCount: item.unpricedCount })), closedLots: fifo.closedLots, costs: fills,
        unattributedOpeningBalance: fifo.unattributedOpeningBalanceExcluded,
      });
      return {
        ok: true,
        value: {
          ...performance,
          benchmarkStatus: performance.points.some((item) => item.benchmarkUsd !== null)
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
      const exploratory = exploratoryRuntime.status();
      if (exploratory !== null && exploratory.status === 'active') {
        const evaluated = await exploratoryRuntime.evaluate();
        if (!evaluated.ok) return evaluated;
        const proposal = listPaperExecutionProposals(options.profileId, 200, database)
          .find((item) => item.runId === evaluated.value.runId);
        return { ok: true, value: {
          status: evaluated.value.submittedCount > 0 ? 'submitted' as const
            : evaluated.value.filledCount > 0 ? 'succeeded' as const : 'blocked' as const,
          proposalId: proposal?.id ?? sha256Hex(`exploratory-no-proposal:${evaluated.value.runId}`),
          proposalHash: proposal?.proposalHash ?? sha256Hex(`exploratory-no-proposal:${evaluated.value.runId}`),
          reasonCode: evaluated.value.standDown,
          filledCount: evaluated.value.filledCount, refusedCount: evaluated.value.refusedCount,
        } };
      }
      const now = clock.nowMs();
      await paperMarket.refresh(now);
      liveMarket.configure(paperInstruments().map((instrument) => instrument.productId));
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
    'research.edge-study': () => ({ ok: true,
      value: readForwardEdgeStatus(options.profileId, database) }),
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
    'research.scoreboard': () => scoreboard.latest(), 'research.lineage': (payload: { readonly limit: number }) => ({ ok: true, value: { asOfMs: clock.nowMs(), scope: 'global', candidates: listResearchLineage(payload.limit, database) } }),
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
    'app.profile-readiness': () => ({ ok: true, value: profileReadiness.view(options.profileId) }),
  } as ChannelHandlers;

  return {
    handlers,
    report,
    recordDeprecatedChannel(channel) {
      diagnostics.logger.warn('deprecated_channel_used', { operation: channel });
    },
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
