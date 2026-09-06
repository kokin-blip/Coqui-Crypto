import { Decimal } from 'decimal.js';

import { sha256Hex } from '../crypto/sha256.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/index.js';
import { assetExposureKey, type AssetExposureKey } from '../connections/index.js';
import type { ExecutionIntent, InstrumentIdentity } from '../types/index.js';

export type PaperVenueProvider = 'coinbase' | 'robinhood_crypto';

export interface AssetExecutionDeltaV1 {
  readonly exposureKey: AssetExposureKey;
  readonly side: 'buy' | 'sell';
  readonly amountUsd: string;
}

export interface ExecutionPlanV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly decisionId: string;
  readonly marketSnapshotHash: string;
  readonly portfolioSnapshotHash: string;
  readonly strategyConfigHash: string;
  readonly riskAssessmentHash: string;
  readonly permissionSnapshotHash: string;
  readonly ruleSnapshotHash: string;
  readonly connectionSetHash: string;
  readonly costModelHash: string;
  readonly deltas: readonly AssetExecutionDeltaV1[];
  readonly createdAtMs: number;
  readonly contentHash: string;
}

export interface ExecutionRouteCandidateV1 {
  readonly connectionId: string;
  readonly provider: PaperVenueProvider;
  readonly exposureKey: AssetExposureKey;
  readonly instrument: InstrumentIdentity;
  readonly supported: boolean;
  readonly availableCashUsd: string;
  readonly availableAssetValueUsd: string;
  readonly feeBps: number;
  readonly spreadBps: number;
  readonly liquidityUsd: string;
  readonly minimumOrderUsd: string;
  readonly permissionMode: 'paper' | 'view_only' | 'unknown';
  readonly health: 'healthy' | 'degraded' | 'unavailable';
  readonly pendingOrderCount: number;
  readonly assumptionHash: string;
}

export interface ExecutionRouteV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly profileId: string;
  readonly decisionId: string;
  readonly planId: string;
  readonly connectionId: string;
  readonly provider: PaperVenueProvider;
  readonly exposureKey: AssetExposureKey;
  readonly instrument: InstrumentIdentity;
  readonly side: 'buy' | 'sell';
  readonly amountUsd: string;
  readonly assumptionHash: string;
  readonly idempotencyKey: string;
  readonly createdAtMs: number;
  readonly contentHash: string;
}

export interface ExecutionRoutingResultV1 {
  readonly routes: readonly ExecutionRouteV1[];
  readonly unrouteable: readonly AssetExecutionDeltaV1[];
}

const SHA256 = /^[0-9a-f]{64}$/u;

function hash(value: unknown): string {
  return sha256Hex(canonicalJson(value as CanonicalJsonValue));
}

function exactPositive(value: string): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite() || !result.isPositive()) throw new TypeError('Execution amount must be positive.');
  return result;
}

export function executionPlanHash(value: ExecutionPlanV1): string {
  return hash({
    schemaVersion: value.schemaVersion, profileId: value.profileId, decisionId: value.decisionId,
    marketSnapshotHash: value.marketSnapshotHash, portfolioSnapshotHash: value.portfolioSnapshotHash,
    strategyConfigHash: value.strategyConfigHash, riskAssessmentHash: value.riskAssessmentHash,
    permissionSnapshotHash: value.permissionSnapshotHash, ruleSnapshotHash: value.ruleSnapshotHash,
    connectionSetHash: value.connectionSetHash, costModelHash: value.costModelHash,
    deltas: value.deltas, createdAtMs: value.createdAtMs,
  });
}

export function createExecutionPlan(input: Omit<ExecutionPlanV1, 'schemaVersion' | 'id' | 'contentHash'>): ExecutionPlanV1 {
  const bindings = [input.decisionId, input.marketSnapshotHash, input.portfolioSnapshotHash,
    input.strategyConfigHash, input.riskAssessmentHash, input.permissionSnapshotHash,
    input.ruleSnapshotHash, input.connectionSetHash, input.costModelHash];
  if (!input.profileId || !bindings.every((value) => SHA256.test(value)) ||
      !Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0 || input.deltas.length === 0) {
    throw new TypeError('Execution plan provenance is incomplete.');
  }
  const deltas = [...input.deltas]
    .map((delta) => Object.freeze({
      exposureKey: assetExposureKey(delta.exposureKey), side: delta.side,
      amountUsd: exactPositive(delta.amountUsd).toString(),
    }))
    .sort((left, right) => left.side !== right.side
      ? left.side === 'sell' ? -1 : 1
      : left.exposureKey.localeCompare(right.exposureKey));
  const material = { schemaVersion: 1 as const, ...input, deltas: Object.freeze(deltas) };
  const contentHash = executionPlanHash({ ...material, id: '', contentHash: '' });
  return Object.freeze({
    ...material, id: sha256Hex(`execution-plan-v1:${contentHash}`), contentHash,
  });
}

export function executionRouteHash(value: ExecutionRouteV1): string {
  return hash({
    schemaVersion: value.schemaVersion, profileId: value.profileId, decisionId: value.decisionId,
    planId: value.planId, connectionId: value.connectionId, provider: value.provider,
    exposureKey: value.exposureKey, instrument: value.instrument, side: value.side,
    amountUsd: value.amountUsd, assumptionHash: value.assumptionHash,
    idempotencyKey: value.idempotencyKey, createdAtMs: value.createdAtMs,
  });
}

function eligible(
  delta: AssetExecutionDeltaV1,
  candidate: ExecutionRouteCandidateV1,
  capacityUsd: Decimal,
  liquidityUsd: Decimal,
): boolean {
  if (!candidate.supported || candidate.exposureKey !== delta.exposureKey ||
      candidate.instrument.venue !== candidate.provider ||
      candidate.permissionMode !== 'paper' || candidate.health !== 'healthy' ||
      candidate.pendingOrderCount > 0 || new Decimal(delta.amountUsd).lt(candidate.minimumOrderUsd)) return false;
  return capacityUsd.gte(delta.amountUsd) && liquidityUsd.gte(delta.amountUsd);
}

function compareCandidates(left: ExecutionRouteCandidateV1, right: ExecutionRouteCandidateV1): number {
  const cost = (left.feeBps + left.spreadBps) - (right.feeBps + right.spreadBps);
  if (cost !== 0) return cost;
  const liquidity = new Decimal(right.liquidityUsd).cmp(left.liquidityUsd);
  if (liquidity !== 0) return liquidity;
  const connection = left.connectionId.localeCompare(right.connectionId);
  return connection !== 0 ? connection : left.instrument.productId.localeCompare(right.instrument.productId);
}

function assertCandidate(candidate: ExecutionRouteCandidateV1): void {
  try {
    const amounts = [candidate.availableCashUsd, candidate.availableAssetValueUsd,
      candidate.liquidityUsd, candidate.minimumOrderUsd].map((value) => new Decimal(value));
    if (!candidate.connectionId || !SHA256.test(candidate.assumptionHash) ||
        !Number.isFinite(candidate.feeBps) || candidate.feeBps < 0 ||
        !Number.isFinite(candidate.spreadBps) || candidate.spreadBps < 0 ||
        !Number.isSafeInteger(candidate.pendingOrderCount) || candidate.pendingOrderCount < 0 ||
        amounts.some((value) => !value.isFinite() || value.isNegative())) {
      throw new TypeError('Invalid route candidate.');
    }
  } catch {
    throw new TypeError('Invalid route candidate.');
  }
}

export function executionRouteCandidatesHash(
  candidates: readonly ExecutionRouteCandidateV1[],
): string {
  for (const candidate of candidates) assertCandidate(candidate);
  const ordered = [...candidates].sort((left, right) => {
    const leftKey = `${left.connectionId}:${left.provider}:${left.exposureKey}:${left.instrument.productId}`;
    const rightKey = `${right.connectionId}:${right.provider}:${right.exposureKey}:${right.instrument.productId}`;
    return leftKey.localeCompare(rightKey);
  });
  return hash(ordered);
}

/** Deterministic venue selection. Strategy inputs never name or rank a venue. */
export function routeExecutionPlan(
  plan: ExecutionPlanV1,
  candidates: readonly ExecutionRouteCandidateV1[],
): ExecutionRoutingResultV1 {
  if (executionPlanHash(plan) !== plan.contentHash ||
      plan.id !== sha256Hex(`execution-plan-v1:${plan.contentHash}`)) {
    throw new TypeError('Execution plan integrity failed.');
  }
  if (executionRouteCandidatesHash(candidates) !== plan.connectionSetHash) {
    throw new TypeError('Route candidates do not match the plan connection binding.');
  }
  const routes: ExecutionRouteV1[] = [];
  const unrouteable: AssetExecutionDeltaV1[] = [];
  const cashRemaining = new Map<string, Decimal>();
  const assetRemaining = new Map<string, Decimal>();
  const liquidityRemaining = new Map<string, Decimal>();
  for (const candidate of candidates) {
    const cash = new Decimal(candidate.availableCashUsd);
    const assetKey = `${candidate.connectionId}:${candidate.exposureKey}`;
    const liquidityKey = `${assetKey}:${candidate.instrument.productId}`;
    const priorCash = cashRemaining.get(candidate.connectionId);
    cashRemaining.set(candidate.connectionId, priorCash === undefined ? cash : Decimal.min(priorCash, cash));
    const asset = new Decimal(candidate.availableAssetValueUsd);
    const priorAsset = assetRemaining.get(assetKey);
    assetRemaining.set(assetKey, priorAsset === undefined ? asset : Decimal.min(priorAsset, asset));
    const liquidity = new Decimal(candidate.liquidityUsd);
    const priorLiquidity = liquidityRemaining.get(liquidityKey);
    liquidityRemaining.set(
      liquidityKey,
      priorLiquidity === undefined ? liquidity : Decimal.min(priorLiquidity, liquidity),
    );
  }
  for (const delta of plan.deltas) {
    const selected = candidates.filter((candidate) => {
      const assetKey = `${candidate.connectionId}:${candidate.exposureKey}`;
      const liquidityKey = `${assetKey}:${candidate.instrument.productId}`;
      const capacity = delta.side === 'buy'
        ? cashRemaining.get(candidate.connectionId)!
        : assetRemaining.get(assetKey)!;
      return eligible(delta, candidate, capacity, liquidityRemaining.get(liquidityKey)!);
    }).sort(compareCandidates)[0];
    if (selected === undefined) {
      unrouteable.push(delta);
      continue;
    }
    const routeScope = {
      schemaVersion: 1 as const, profileId: plan.profileId, decisionId: plan.decisionId,
      planId: plan.id, connectionId: selected.connectionId, provider: selected.provider,
      exposureKey: delta.exposureKey, instrument: selected.instrument, side: delta.side,
      amountUsd: delta.amountUsd, assumptionHash: selected.assumptionHash, createdAtMs: plan.createdAtMs,
    };
    const routeScopeHash = hash(routeScope);
    const idempotencyKey = sha256Hex([
      plan.profileId, plan.decisionId, plan.id, routeScopeHash, selected.connectionId,
    ].join(':'));
    const material = { ...routeScope, idempotencyKey };
    const contentHash = executionRouteHash({ ...material, id: '', contentHash: '' });
    routes.push(Object.freeze({
      ...material, id: sha256Hex(`execution-route-v1:${contentHash}`), contentHash,
    }));
    const amount = new Decimal(delta.amountUsd);
    const assetKey = `${selected.connectionId}:${selected.exposureKey}`;
    const liquidityKey = `${assetKey}:${selected.instrument.productId}`;
    if (delta.side === 'buy') {
      cashRemaining.set(selected.connectionId, cashRemaining.get(selected.connectionId)!.minus(amount));
    } else {
      assetRemaining.set(assetKey, assetRemaining.get(assetKey)!.minus(amount));
    }
    liquidityRemaining.set(liquidityKey, liquidityRemaining.get(liquidityKey)!.minus(amount));
  }
  return Object.freeze({ routes: Object.freeze(routes), unrouteable: Object.freeze(unrouteable) });
}

export function executionDeltasFromIntents(intents: readonly ExecutionIntent[]): readonly AssetExecutionDeltaV1[] {
  const totals = new Map<string, Decimal>();
  for (const intent of intents) {
    const key = `${intent.side}:${assetExposureKey(intent.asset.baseAsset)}`;
    totals.set(key, (totals.get(key) ?? new Decimal(0)).plus(intent.amountUsd));
  }
  return Object.freeze([...totals.entries()].map(([key, amount]) => {
    const [side, exposure] = key.split(':') as ['buy' | 'sell', string];
    return Object.freeze({ exposureKey: assetExposureKey(exposure), side, amountUsd: amount.toString() });
  }));
}

export interface PaperVenuePlacement {
  readonly accepted: boolean;
  readonly providerOrderId: string | null;
  readonly reasonCode: 'accepted' | 'assumption_changed' | 'venue_refused';
  readonly idempotencyKey: string;
}

export interface PaperVenueAdapter {
  readonly provider: PaperVenueProvider;
  place(route: ExecutionRouteV1): PaperVenuePlacement;
}
