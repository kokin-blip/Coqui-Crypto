import { sha256Hex } from '../crypto/sha256.js';

export type DecisionMarketFreshness = 'fresh' | 'stale' | 'unavailable';
export type DecisionHistoryStatus = 'complete' | 'partial' | 'insufficient' | 'unavailable';

export interface StrategyDecisionTargetV1 {
  readonly assetId: string;
  readonly weight: number;
}

export interface StrategyDecisionV1 {
  readonly schemaVersion: 1;
  readonly decisionId: string;
  readonly profileId: string;
  readonly runId: string;
  readonly scheduledForMs: number;
  readonly strategy: {
    readonly id: string;
    readonly version: string;
    readonly configHash: string;
  };
  readonly market: {
    readonly snapshotHash: string | null;
    readonly asOfMs: number | null;
    readonly expectedAsOfMs: number | null;
    readonly freshness: DecisionMarketFreshness;
    readonly refreshResult: string;
    readonly ruleSnapshotHash: string | null;
    readonly rulesFresh: boolean;
  };
  readonly portfolio: {
    readonly snapshotHash: string | null;
    readonly version: string | null;
    readonly source: 'profile_holdings' | 'paper_ledger' | 'unavailable';
  };
  readonly targets: readonly StrategyDecisionTargetV1[];
  readonly cashWeight: number | null;
  readonly exposure: number | null;
  readonly historyStatus: DecisionHistoryStatus;
  readonly facts: {
    readonly momentum: readonly {
      readonly assetId: string;
      readonly returnPct: number;
      readonly volatilityPct: number;
      readonly riskAdjustedMomentum: number;
    }[];
    readonly realizedVolPct: number | null;
    readonly belowTrend: boolean | null;
  } | null;
  readonly createdAtMs: number;
}

export type DecisionEvidenceKindV1 =
  | 'strategy_evaluated'
  | 'risk_evaluated'
  | 'execution_planned'
  | 'no_trade'
  | 'stand_down'
  | 'execution_submitted'
  | 'execution_filled'
  | 'execution_refused'
  | 'recovery';

export interface DecisionEvidenceDetailByKindV1 {
  readonly strategy_evaluated: { readonly decisionHash: string };
  readonly risk_evaluated: {
    readonly approved: boolean;
    readonly reasonCodes: readonly string[];
    readonly assessmentHash: string;
  };
  readonly execution_planned: {
    readonly planId: string;
    readonly planHash: string;
    readonly intentCount: number;
  };
  readonly no_trade: {
    readonly reasonCode: string;
    readonly estimatedTradeUsd: string | null;
    readonly minimumUsefulTradeUsd: string | null;
  };
  readonly stand_down: { readonly reasonCode: string };
  readonly execution_submitted: {
    readonly proposalId: string;
    readonly proposalHash: string;
    readonly orderIds: readonly string[];
  };
  readonly execution_filled: {
    readonly proposalId: string;
    readonly filledCount: number;
    readonly refusedCount: number;
  };
  readonly execution_refused: {
    readonly proposalId: string | null;
    readonly reasonCode: string;
    readonly refusedCount: number;
  };
  readonly recovery: {
    readonly orderId: string;
    readonly disposition: 'filled' | 'cancelled' | 'expired' | 'unknown' | 'reconciled';
  };
}

export type DecisionEvidenceEventV1 = {
  readonly [Kind in DecisionEvidenceKindV1]: {
    readonly schemaVersion: 1;
    readonly decisionId: string;
    readonly profileId: string;
    readonly sequence: number;
    readonly kind: Kind;
    readonly atMs: number;
    readonly detail: DecisionEvidenceDetailByKindV1[Kind];
  }
}[DecisionEvidenceKindV1];

type JsonPrimitive = string | number | boolean | null;
export type CanonicalJsonValue =
  | JsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function canonicalize(value: CanonicalJsonValue): CanonicalJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON numbers must be finite.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = value as { readonly [key: string]: CanonicalJsonValue };
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [key, canonicalize(object[key]!)]),
  );
}

/** Stable JSON for immutable identities; object keys sort recursively, arrays retain order. */
export function canonicalJson(value: CanonicalJsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function strategyDecisionId(profileId: string, scheduledForMs: number): string {
  return sha256Hex(`strategy-decision-v1:${profileId}:${scheduledForMs}`);
}

export function strategyDecisionJson(decision: StrategyDecisionV1): string {
  return canonicalJson(decision as unknown as CanonicalJsonValue);
}

export function strategyDecisionHash(decision: StrategyDecisionV1): string {
  return sha256Hex(strategyDecisionJson(decision));
}

export function decisionEvidenceEventJson(event: DecisionEvidenceEventV1): string {
  return canonicalJson(event as unknown as CanonicalJsonValue);
}
