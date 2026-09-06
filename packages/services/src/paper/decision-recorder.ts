import {
  instrumentKey,
  type AllocationPolicy,
  type Holding,
  type StrategyDecisionV1,
} from '@coqui/core';
import {
  appendDecisionEvidenceEvent,
  getStrategyDecision,
  inTransaction,
  saveStrategyDecision,
  type Db,
} from '@coqui/storage';

import { hashCanonical, type PaperDecisionPreparation } from './runtime-model.js';

export interface PaperStrategyIdentity {
  readonly id: string;
  readonly version: string;
  readonly historyStatus: StrategyDecisionV1['historyStatus'];
  readonly facts: StrategyDecisionV1['facts'];
  readonly portfolioSource: StrategyDecisionV1['portfolio']['source'];
  readonly configMaterial?: unknown;
}

export function recordPaperDecision(input: {
  readonly database: Db;
  readonly profileId: string;
  readonly runId: string;
  readonly decisionId: string;
  readonly scheduledForMs: number;
  readonly decidedAtMs: number;
  readonly policy: AllocationPolicy | null;
  readonly holdings: readonly Holding[] | null;
  readonly preparation: PaperDecisionPreparation | null;
  readonly strategy: PaperStrategyIdentity;
}): { readonly createdAtMs: number; readonly contentHash: string; readonly configHash: string } {
  const existing = getStrategyDecision(input.decisionId, input.database);
  const createdAtMs = existing?.decision.createdAtMs ?? input.decidedAtMs;
  const targets = (input.policy?.targets ?? [])
    .map((target) => ({ assetId: instrumentKey(target.instrument), weight: target.weight }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  const targetExposure = targets.reduce((sum, target) => sum + target.weight, 0);
  const holdings = input.holdings?.map((holding) => ({
    assetId: instrumentKey(holding.asset.instrument),
    priceUsd: holding.priceUsd,
    quantity: holding.quantity,
    valueUsd: holding.valueUsd,
  })).sort((left, right) => left.assetId.localeCompare(right.assetId)) ?? null;
  const configHash = hashCanonical(input.strategy.configMaterial ?? (input.policy === null
    ? null
    : { rebalanceBandPct: input.policy.rebalanceBandPct, targets }));
  const preparationFailure = input.preparation !== null && !input.preparation.ok
    ? input.preparation.code
    : null;
  const decision: StrategyDecisionV1 = {
    schemaVersion: 1,
    decisionId: input.decisionId,
    profileId: input.profileId,
    runId: input.runId,
    scheduledForMs: input.scheduledForMs,
    strategy: { id: input.strategy.id, version: input.strategy.version, configHash },
    market: {
      snapshotHash: input.preparation?.datasetHash ?? null,
      asOfMs: input.preparation?.latestCompletedStartMs ?? null,
      expectedAsOfMs: input.preparation?.expectedCompletedStartMs ?? null,
      freshness: preparationFailure === 'stale_market_data'
        ? 'stale'
        : input.preparation?.datasetHash !== undefined ? 'fresh' : 'unavailable',
      refreshResult: input.preparation === null
        ? 'not_requested'
        : input.preparation.ok ? 'succeeded' : input.preparation.code,
      ruleSnapshotHash: input.preparation?.ruleSnapshotHash ?? null,
      rulesFresh: input.preparation === null
        ? false
        : input.preparation.ok ? true : input.preparation.rulesFresh ?? false,
    },
    portfolio: {
      snapshotHash: holdings === null ? null : hashCanonical(holdings),
      version: holdings === null
        ? null
        : input.strategy.portfolioSource === 'paper_ledger'
          ? 'paper-portfolio-snapshot-v1'
          : 'legacy-profile-holdings-v1',
      source: holdings === null ? 'unavailable' : input.strategy.portfolioSource,
    },
    targets,
    cashWeight: input.policy === null ? null : Math.max(0, 1 - targetExposure),
    exposure: input.policy === null ? null : Math.min(1, targetExposure),
    historyStatus: input.strategy.historyStatus,
    facts: input.strategy.facts,
    createdAtMs,
  };
  return inTransaction(input.database, () => {
    const stored = saveStrategyDecision(decision, input.database);
    appendDecisionEvidenceEvent({
      schemaVersion: 1,
      decisionId: input.decisionId,
      profileId: input.profileId,
      sequence: 0,
      kind: 'strategy_evaluated',
      atMs: createdAtMs,
      detail: { decisionHash: stored.contentHash },
    }, input.database);
    return { createdAtMs, contentHash: stored.contentHash, configHash };
  });
}
