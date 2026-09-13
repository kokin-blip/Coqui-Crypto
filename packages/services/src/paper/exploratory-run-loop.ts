import { Decimal } from 'decimal.js';

import {
  canonicalJson,
  decimal,
  DEFAULT_MOMENTUM_CONFIG,
  DEFAULT_VOL_TARGET_CONFIG,
  sha256Hex,
  strategyDecisionId,
  trendVolTargets,
  type AllocationPolicy,
  type DecisionEvidenceEventV1,
  type Holding,
  type InstrumentIdentity,
  type InstrumentKey,
} from '@coqui/core';
import {
  appendDecisionEvidenceEvent,
  currentExploratoryPaperCampaign,
  DEFAULT_REBALANCE_BAND_PCT,
  getWalletDecisionRun,
  inTransaction,
  linkExploratoryPaperExecution,
  linkWalletDecisionRun,
  listDecisionEvidenceEvents,
  listExploratoryPaperBalances,
  listSubmittedExploratoryPaperExecutions,
  saveWalletDecisionRun,
} from '@coqui/storage';

import { recordPaperDecision } from './decision-recorder.js';
import { PaperExecutionService } from './execution-service.js';
import { paperCostModelHash } from './venue.js';
import {
  hashCanonical,
  journal,
  normalizedMix,
  planExploratoryRebalance,
  type PaperRunLoopDependencies,
  type PaperRunStandDown,
  type PaperRunSummary,
} from './runtime-model.js';
import { resolveKillSwitch } from './kill-switch.js';
import { EXPLORATORY_TRENDVOL_VERSION } from './exploratory-campaign.js';

function instrumentFromKey(assetId: string): InstrumentIdentity {
  const [venue, productType, productId, extra] = assetId.split('|');
  if (venue !== 'coinbase' || productType !== 'spot' || !productId || extra !== undefined) {
    throw new Error(`Invalid exploratory instrument ${assetId}.`);
  }
  return { venue, productType, productId };
}

function holdingsForCampaign(
  profileId: string,
  campaignId: string,
  preparation: Extract<ReturnType<PaperRunLoopDependencies['preparation']>, { ok: true }>,
  database: PaperRunLoopDependencies['database'],
): readonly Holding[] {
  return listExploratoryPaperBalances(campaignId, profileId, database)
    .filter((balance) => balance.managed && balance.assetId !== null)
    .map((balance) => {
      const instrument = instrumentFromKey(balance.assetId!);
      const price = preparation.dataset.closesById[balance.assetId! as InstrumentKey]?.at(-1);
      if (!Number.isFinite(price) || price! <= 0) throw new Error('paper_book_incomplete');
      const symbol = instrument.productId.replace(/-USD$/u, '');
      const priceUsd = decimal(String(price));
      return Object.freeze({
        asset: { instrument, symbol, name: symbol, baseAsset: symbol,
          quoteAsset: 'USD' as const, coingeckoId: null },
        quantity: decimal(balance.quantity), avgCostUsd: priceUsd, priceUsd,
        valueUsd: decimal(new Decimal(balance.quantity).mul(price!).toFixed()),
        unrealizedPnlUsd: decimal('0'), unrealizedPnlPct: 0,
      });
    });
}

export function runExploratoryPaperDecision(
  dependencies: PaperRunLoopDependencies,
  scheduledForMs: number,
): PaperRunSummary {
  const { database, profileId } = dependencies;
  const current = currentExploratoryPaperCampaign(profileId, database);
  if (current === null || current.status !== 'active') {
    throw new Error('No active exploratory paper campaign.');
  }
  const campaign = current.campaign;
  const runId = sha256Hex(`exploratory-paper:${profileId}:${campaign.campaignId}:${scheduledForMs}`);
  const decisionId = strategyDecisionId(profileId, scheduledForMs);
  let decidedAtMs = dependencies.clock.nowMs();
  let decisionHash: string | null = null;
  let planned: { proposalId: string; planHash: string; proposalHash: string | null } | null = null;
  let executionHoldings: readonly Holding[] = [];
  let balances = listExploratoryPaperBalances(campaign.campaignId, profileId, database);

  const execution = new PaperExecutionService({
    database, profileId, nowMs: () => dependencies.clock.nowMs(), market: dependencies.market,
    state: () => ({ holdings: executionHoldings,
      killSwitchEngaged: resolveKillSwitch(profileId, database).engaged,
      evidenceVerified: false, historicalGrossEdgeLowerBoundPct: null,
      admissionMode: 'exploratory', campaignId: campaign.campaignId,
      exploratoryAuthorized: currentExploratoryPaperCampaign(profileId, database)?.status === 'active' &&
        currentExploratoryPaperCampaign(profileId, database)?.campaign.campaignId === campaign.campaignId }),
    ...(dependencies.executionOwnerId === undefined ? {} : { executionOwnerId: dependencies.executionOwnerId }),
    ...(dependencies.onUnexpectedError === undefined ? {} : { onUnexpectedError: dependencies.onUnexpectedError }),
  });

  const preparation = dependencies.preparation();
  if (preparation.ok) {
    const settlement = execution.settlePending();
    for (const outcome of settlement.outcomes) {
      const prior = listDecisionEvidenceEvents(outcome.decisionId, profileId, database);
      appendDecisionEvidenceEvent({
        schemaVersion: 1, decisionId: outcome.decisionId, profileId, sequence: prior.length,
        kind: outcome.disposition === 'filled' ? 'execution_filled' : 'recovery', atMs: outcome.atMs,
        detail: outcome.disposition === 'filled'
          ? { proposalId: prior.find((event) => event.kind === 'execution_submitted')?.kind === 'execution_submitted'
              ? (prior.find((event) => event.kind === 'execution_submitted') as Extract<DecisionEvidenceEventV1, { kind: 'execution_submitted' }>).detail.proposalId
              : 'unknown', filledCount: 1, refusedCount: 0 }
          : { orderId: outcome.orderId, disposition: 'expired' },
      } as DecisionEvidenceEventV1, database);
    }
    balances = listExploratoryPaperBalances(campaign.campaignId, profileId, database);
  }

  const existing = getWalletDecisionRun(runId, database);
  if (existing !== null && existing.status === 'completed') {
    const stored = JSON.parse(existing.snapshotJson) as { standDown: PaperRunStandDown | null;
      filled: number; submitted?: number; refused: number; preDecisionBalances?: PaperRunSummary['preDecisionBalances'] };
    return { profileId, runId, strategyVersion: EXPLORATORY_TRENDVOL_VERSION,
      scheduledForMs, decidedAtMs: existing.createdAt, standDown: stored.standDown,
      filledCount: stored.filled, submittedCount: stored.submitted ?? 0,
      refusedCount: stored.refused, preDecisionBalances: stored.preDecisionBalances ?? [] };
  }

  const persistDecision = (policy: AllocationPolicy | null, holdings: readonly Holding[] | null,
    historyStatus: 'complete' | 'partial' | 'insufficient' | 'unavailable' = 'unavailable',
    facts: Parameters<typeof recordPaperDecision>[0]['strategy']['facts'] = null): void => {
    const recorded = recordPaperDecision({ database, profileId, runId, decisionId,
      scheduledForMs, decidedAtMs, policy, holdings, preparation,
      strategy: { id: 'trendvol', version: EXPLORATORY_TRENDVOL_VERSION,
        historyStatus, facts, portfolioSource: 'paper_ledger',
        configMaterial: { campaignId: campaign.campaignId, baseWeights: campaign.baseWeights,
          momentum: DEFAULT_MOMENTUM_CONFIG, volTarget: DEFAULT_VOL_TARGET_CONFIG,
          eligibleForValidation: false, eligibleForPromotion: false, eligibleForLiveExecution: false } } });
    decidedAtMs = recorded.createdAtMs;
    decisionHash = recorded.contentHash;
    linkExploratoryPaperExecution({ campaignId: campaign.campaignId, profileId,
      decisionId, createdAtMs: decidedAtMs }, database);
  };

  const finish = (standDown: PaperRunStandDown | null, filled = 0, refused = 0,
    submitted = 0): PaperRunSummary => {
    if (decisionHash === null) throw new Error('Exploratory outcome has no durable decision.');
    const sequence = planned === null ? 1 : 2;
    const terminal: DecisionEvidenceEventV1 = standDown === 'no_intents'
      ? { schemaVersion: 1, decisionId, profileId, sequence, kind: 'no_trade', atMs: decidedAtMs,
          detail: { reasonCode: 'no_intents', estimatedTradeUsd: null, minimumUsefulTradeUsd: null } }
      : standDown === 'pending_settlement' && planned !== null
        ? { schemaVersion: 1, decisionId, profileId, sequence, kind: 'execution_submitted', atMs: decidedAtMs,
            detail: { proposalId: planned.proposalId,
              proposalHash: planned.proposalHash!,
              orderIds: listSubmittedExploratoryPaperExecutions(campaign.campaignId, profileId, database)
                .filter((item) => item.decisionId === decisionId).map((item) => item.orderId) } }
        : standDown === null && planned !== null
          ? { schemaVersion: 1, decisionId, profileId, sequence, kind: 'execution_filled', atMs: decidedAtMs,
              detail: { proposalId: planned.proposalId, filledCount: filled, refusedCount: refused } }
          : ['gates_refused', 'execution_failed', 'execution_unknown'].includes(standDown ?? '')
            ? { schemaVersion: 1, decisionId, profileId, sequence, kind: 'execution_refused', atMs: decidedAtMs,
                detail: { proposalId: planned?.proposalId ?? null, reasonCode: standDown!, refusedCount: refused } }
            : { schemaVersion: 1, decisionId, profileId, sequence, kind: 'stand_down', atMs: decidedAtMs,
                detail: { reasonCode: standDown ?? 'completed' } };
    const preDecisionBalances = balances.map((balance) => Object.freeze({
      assetId: balance.assetId ?? balance.exposureKey, quantity: balance.quantity,
    }));
    inTransaction(database, () => {
      appendDecisionEvidenceEvent(terminal, database);
      saveWalletDecisionRun({ id: runId, profileId, scheduledFor: scheduledForMs,
        strategyVersion: EXPLORATORY_TRENDVOL_VERSION, snapshotHash: decisionHash!,
        snapshotJson: canonicalJson({ campaignId: campaign.campaignId, decisionId, filled,
          submitted, refused, standDown, preDecisionBalances,
          eligibleForValidation: false, eligibleForPromotion: false, eligibleForLiveExecution: false }),
        status: 'completed', createdAt: decidedAtMs, updatedAt: decidedAtMs, error: null }, database);
      linkWalletDecisionRun(runId, decisionId, database);
    });
    journal(database, profileId, runId, decidedAtMs, 'exploratory_paper_run', 'completed', {
      campaignId: campaign.campaignId, standDown, filled, refused, submitted,
      eligibleForValidation: false, eligibleForPromotion: false, eligibleForLiveExecution: false,
    });
    return { profileId, runId, strategyVersion: EXPLORATORY_TRENDVOL_VERSION, scheduledForMs,
      decidedAtMs, standDown, filledCount: filled, submittedCount: submitted,
      refusedCount: refused, preDecisionBalances };
  };

  if (resolveKillSwitch(profileId, database).engaged) {
    persistDecision(null, null);
    return finish('kill_switch_engaged');
  }
  if (!preparation.ok) {
    persistDecision(null, null);
    return finish(preparation.code);
  }

  try {
    executionHoldings = holdingsForCampaign(profileId, campaign.campaignId, preparation, database);
  } catch (error) {
    if (error instanceof Error && error.message === 'paper_book_incomplete') {
      persistDecision(null, null);
      return finish('paper_book_incomplete');
    }
    throw error;
  }
  const instruments = new Map(campaign.baseWeights.map((target) =>
    [target.assetId, instrumentFromKey(target.assetId)]));
  const basePolicy: AllocationPolicy = {
    rebalanceBandPct: dependencies.policy()?.rebalanceBandPct ?? DEFAULT_REBALANCE_BAND_PCT,
    targets: campaign.baseWeights.map((target) => ({ instrument: instruments.get(target.assetId)!,
      weight: target.weight })) };
  const trend = trendVolTargets(campaign.baseWeights.map((target) => ({
    assetId: target.assetId as InstrumentKey, weight: target.weight,
  })), preparation.dataset.closesById,
    normalizedMix(basePolicy, preparation.dataset));
  const targetPolicy: AllocationPolicy = { rebalanceBandPct: basePolicy.rebalanceBandPct,
    targets: trend.targets.map((target) => ({ instrument: instruments.get(target.assetId)!,
      weight: target.weight })) };
  persistDecision(targetPolicy, executionHoldings, trend.historyStatus, {
    momentum: trend.momentum.stats, realizedVolPct: trend.volatility.realizedVolPct,
    belowTrend: trend.volatility.belowTrend,
  });
  const cashUsd = balances.find((balance) => balance.exposureKey === 'USD')?.quantity ?? '0';
  const intents = planExploratoryRebalance(executionHoldings, cashUsd, targetPolicy);
  if (intents.length === 0) return finish('no_intents');

  planned = { proposalId: sha256Hex(`exploratory-paper-proposal:${runId}:1`),
    planHash: hashCanonical(intents), proposalHash: null };
  appendDecisionEvidenceEvent({ schemaVersion: 1, decisionId, profileId, sequence: 1,
    kind: 'execution_planned', atMs: decidedAtMs,
    detail: { planId: planned.proposalId, planHash: planned.planHash, intentCount: intents.length } }, database);
  const outcome = execution.prepare({ proposalId: planned.proposalId, runId, revision: 1, intents,
    pending: { decisionId, requiredExecutionBarStartMs: preparation.latestCompletedStartMs + 86_400_000,
      costModelHash: paperCostModelHash() } });
  planned.proposalHash = outcome.proposalHash;
  if (outcome.status === 'submitted') return finish('pending_settlement', 0, outcome.refusedCount,
    listSubmittedExploratoryPaperExecutions(campaign.campaignId, profileId, database)
      .filter((item) => item.decisionId === decisionId).length);
  if (outcome.status === 'pending') return finish('pending_review');
  if (outcome.status === 'unknown') return finish('execution_unknown', 0, outcome.refusedCount);
  if (outcome.status === 'failed') return finish('execution_failed', 0, outcome.refusedCount);
  if (outcome.status === 'blocked') return finish(
    outcome.reasonCode === 'kill_switch_engaged' ? 'kill_switch_engaged' : 'gates_refused',
    0, outcome.refusedCount);
  return finish(null, outcome.filledCount, outcome.refusedCount);
}
