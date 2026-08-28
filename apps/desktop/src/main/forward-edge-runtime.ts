import {
  deriveForwardCounterfactual,
  materializeForwardEdgeResult,
  sha256Hex,
  type ForwardEdgeStudyPlan,
} from '@coqui/core';
import {
  reconcilePaperFills,
  ResearchScoreboardService,
  type PaperMarketData,
  type PaperRunSummary,
} from '@coqui/services';
import {
  acknowledgeWalletSafetyStop,
  activateWalletSafetyStop,
  appendPaperCampaignEvent,
  ensurePaperCampaign,
  getWalletSafetyStop,
  latestPaperCampaign,
  listForwardEdgeObservations,
  listPaperFillPerformanceFactsForRun,
  readForwardEdgeStudyStatus,
  recordForwardEdgeStudyResult,
  saveForwardEdgeObservation,
  type Db,
  type PaperCampaignStatus,
  type PaperDailyValuationEvidence,
} from '@coqui/storage';

import { capturePaperPerformanceEvidence } from './paper-performance-evidence.js';

const DAY_MS = 86_400_000;

function latestClose(market: PaperMarketData, productId: string, dayUtc: number): string | null {
  const until = dayUtc + DAY_MS;
  const bars = market.bars(`coinbase|spot|${productId}` as Parameters<PaperMarketData['bars']>[0])
    .filter((bar) => bar.isComplete && bar.endTimeMs <= until)
    .sort((left, right) => left.endTimeMs - right.endTimeMs);
  const close = bars.at(-1)?.close;
  return close === undefined || !Number.isFinite(close) || close < 0 ? null : String(close);
}

/** Persist one actual post-run observation. It never invents an absent scheduler day. */
export function captureForwardEdgeObservation(input: {
  readonly profileId: string;
  readonly plan: ForwardEdgeStudyPlan;
  readonly planHash: string;
  readonly summary: PaperRunSummary;
  readonly valuation: PaperDailyValuationEvidence;
  readonly market: PaperMarketData;
  readonly database: Db;
}): void {
  const dayUtc = input.valuation.dayUtc;
  if (dayUtc < input.plan.firstEligibleDayUtcMs) return;
  const fills = listPaperFillPerformanceFactsForRun(
    input.profileId,
    input.summary.runId,
    input.database,
  );
  const parsedPositions = JSON.parse(input.valuation.positionsJson) as Array<{
    instrument: { productId: string }; quantity: string; valueUsd: string | null;
  }>;
  const counterfactual = deriveForwardCounterfactual({
    preDecisionBalances: input.summary.preDecisionBalances,
    valuedPositions: parsedPositions.map((position) => ({
      productId: position.instrument.productId,
      quantity: position.quantity,
      valueUsd: position.valueUsd,
    })),
    fills,
  });
  const marketPrices = Object.fromEntries(input.plan.universe.map((productId) =>
    [productId, latestClose(input.market, productId, dayUtc)]));
  const marketPricesJson = JSON.stringify(marketPrices);
  const provenanceJson = JSON.stringify({
    paperOnly: true,
    forwardOnly: true,
    noHistoricalBackfill: true,
    runId: input.summary.runId,
    dailyValuationEvidenceHash: input.valuation.evidenceHash,
    fillMarketSnapshotHashes: fills.map((fill) => fill.marketSnapshotHash),
  });
  const record = {
    id: sha256Hex(`forward-observation:${input.planHash}:${input.profileId}:${dayUtc}`),
    planHash: input.planHash,
    profileId: input.profileId,
    dayUtc,
    runId: input.summary.runId,
    observedAt: input.valuation.capturedAt,
    actualEquityUsd: input.valuation.equityUsd,
    holdEquityUsd: input.valuation.benchmarkUsd,
    noTradeEquityUsd: counterfactual.noTradeEndingEquityUsd,
    turnoverUsd: counterfactual.turnoverUsd,
    recordedCostUsd: counterfactual.recordedCostUsd,
    marketPricesJson,
    valuationComplete: input.valuation.unpricedCount === 0 &&
      input.valuation.equityUsd !== null && input.valuation.benchmarkUsd !== null &&
      counterfactual.noTradeEndingEquityUsd !== null &&
      Object.values(marketPrices).every((value) => value !== null),
    stateHash: sha256Hex(JSON.stringify(input.summary.preDecisionBalances)),
    provenanceJson,
    evidenceHash: '',
  };
  const evidenceHash = sha256Hex(JSON.stringify({ ...record, evidenceHash: undefined }));
  saveForwardEdgeObservation({ ...record, evidenceHash }, input.database);

  let campaign = latestPaperCampaign(input.profileId, input.database);
  if (campaign !== null && campaign.state !== 'completed' &&
      dayUtc >= campaign.startDayUtc + campaign.requiredDays * DAY_MS &&
      campaign.observedDays < campaign.requiredDays) {
    appendPaperCampaignEvent({
      campaignId: campaign.id,
      dayUtc,
      runId: `${input.summary.runId}:missed-consecutive-day`,
      status: 'failed',
      at: input.summary.decidedAtMs,
      detail: { reason: 'seven_consecutive_utc_days_not_observed' },
    }, input.database);
    campaign = null;
  }
  campaign ??= ensurePaperCampaign({
    profileId: input.profileId,
    kind: 'zero_edge_stand_down',
    startDayUtc: dayUtc,
    registeredAt: input.summary.decidedAtMs,
  }, input.database);
  appendPaperCampaignEvent({
    campaignId: campaign.id,
    dayUtc,
    runId: input.summary.runId,
    status: 'observed',
    at: input.summary.decidedAtMs,
    detail: {
      standDown: input.summary.standDown,
      filledCount: input.summary.filledCount,
      refusedCount: input.summary.refusedCount,
      observationEvidenceHash: evidenceHash,
    },
  }, input.database);
}

/**
 * Persist the preregistered terminal result once the real forward sample is
 * large enough. Until then the status remains collecting; no partial result is
 * promoted and no elapsed day is manufactured.
 */
export function finalizeForwardEdgeStudyIfReady(input: {
  readonly profileId: string;
  readonly plan: ForwardEdgeStudyPlan;
  readonly planHash: string;
  readonly completedAt: number;
  readonly database: Db;
}): 'not_ready' | 'already_final' | 'passed' | 'failed' {
  const status = readForwardEdgeStudyStatus(input.database);
  if (status.result !== null) return 'already_final';
  const observations = listForwardEdgeObservations(
    input.planHash,
    input.profileId,
    input.database,
  );
  const completedDays = observations.filter((item) => item.valuationComplete).length;
  const costBearing = observations.filter((item) => Number(item.turnoverUsd) > 0).length;
  if (completedDays < input.plan.minimumCompletedDays ||
      costBearing < input.plan.minimumCostBearingRebalances) return 'not_ready';
  const integrityVerified = observations.every((observation) => {
    const { evidenceHash, ...content } = observation;
    return sha256Hex(JSON.stringify(content)) === evidenceHash;
  });
  const scoreboard = new ResearchScoreboardService({ database: input.database }).latest();
  const result = materializeForwardEdgeResult({
    planHash: input.planHash,
    observations: observations.map((item) => ({
      dayUtc: item.dayUtc,
      actualEquityUsd: item.actualEquityUsd,
      holdEquityUsd: item.holdEquityUsd,
      noTradeEquityUsd: item.noTradeEquityUsd,
      turnoverUsd: item.turnoverUsd,
      recordedCostUsd: item.recordedCostUsd,
      marketPrices: JSON.parse(item.marketPricesJson) as Readonly<Record<string, string | null>>,
      valuationComplete: item.valuationComplete,
      evidenceHash: item.evidenceHash,
    })),
    observedTrialSharpes: scoreboard.ok
      ? scoreboard.value.tracks.flatMap((track) => track.sharpe === null ? [] : [track.sharpe])
      : [],
    bootstrapSeed: 49,
  });
  if (result.outcome === 'incomplete') return 'not_ready';
  recordForwardEdgeStudyResult(result, input.completedAt, integrityVerified, input.database);
  return result.outcome;
}

/** One composition-root callback for the daily valuation, observation and terminal study check. */
export async function captureScheduledForwardEvidence(input: {
  readonly profileId: string;
  readonly plan: ForwardEdgeStudyPlan;
  readonly planHash: string;
  readonly summary: PaperRunSummary;
  readonly database: Db;
  readonly clock: Parameters<typeof capturePaperPerformanceEvidence>[0]['clock'];
  readonly priceSource: Parameters<typeof capturePaperPerformanceEvidence>[0]['priceSource'];
  readonly market: PaperMarketData;
}): Promise<void> {
  const valuation = await capturePaperPerformanceEvidence({
    profileId: input.profileId,
    runId: input.summary.runId,
    scheduledForMs: input.summary.scheduledForMs,
    database: input.database,
    clock: input.clock,
    priceSource: input.priceSource,
  });
  captureForwardEdgeObservation({ ...input, valuation });
  const campaign = latestPaperCampaign(input.profileId, input.database);
  if (campaign !== null && campaign.observedDays === campaign.requiredDays && !campaign.reconciled) {
    const report = reconcilePaperFills({
      database: input.database,
      clock: input.clock,
      market: input.market,
    }, input.profileId, campaign.startDayUtc);
    const reconciled = report.divergedCount === 0 && report.unverifiableCount === 0;
    appendPaperCampaignEvent({
      campaignId: campaign.id,
      dayUtc: valuation.dayUtc,
      runId: `${input.summary.runId}:reconciliation`,
      status: reconciled ? 'reconciled' : 'failed',
      at: input.summary.decidedAtMs,
      detail: {
        fillCount: report.fillCount,
        alignedCount: report.alignedCount,
        divergedCount: report.divergedCount,
        unverifiableCount: report.unverifiableCount,
        fillSpecificExitSatisfied: report.fillCount > 0,
      },
    }, input.database);
  }
  finalizeForwardEdgeStudyIfReady({
    profileId: input.profileId,
    plan: input.plan,
    planHash: input.planHash,
    completedAt: input.clock.nowMs(),
    database: input.database,
  });
}

export function handlePaperCampaignKillSwitch(input: {
  readonly profileId: string;
  readonly commandId: string;
  readonly action: 'exercise' | 'acknowledge';
  readonly explicitConfirmation: true;
  readonly at: number;
  readonly database: Db;
}): PaperCampaignStatus | null {
  const campaign = latestPaperCampaign(input.profileId, input.database);
  if (campaign === null) return null;
  const currentStop = getWalletSafetyStop(input.profileId, input.database);
  if (currentStop?.active === true && currentStop.kind !== 'campaign_exercise') {
    throw new Error('An unrelated safety stop cannot be replaced or acknowledged by the campaign.');
  }
  if (input.action === 'exercise') activateWalletSafetyStop({
    eventId: sha256Hex(`campaign-kill-switch:${input.commandId}`),
    profileId: input.profileId,
    kind: 'campaign_exercise',
    reason: 'Seven-day paper campaign safety-stop exercise.',
    at: input.at,
    runId: input.commandId,
  }, input.database);
  else acknowledgeWalletSafetyStop({
    eventId: sha256Hex(`campaign-kill-switch:${input.commandId}`),
    profileId: input.profileId,
    reason: 'Campaign exercise observed; restore acknowledged through the normal safety path.',
    at: input.at,
  }, input.database);
  appendPaperCampaignEvent({
    campaignId: campaign.id,
    dayUtc: Math.floor(input.at / DAY_MS) * DAY_MS,
    runId: input.commandId,
    status: input.action === 'exercise' ? 'kill_switch_exercised' : 'kill_switch_acknowledged',
    at: input.at,
    detail: { explicitConfirmation: input.explicitConfirmation },
  }, input.database);
  return latestPaperCampaign(input.profileId, input.database);
}
