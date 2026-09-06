import { sha256Hex } from '../crypto/sha256.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/index.js';

export interface EvolutionMetricsV1 {
  readonly oosReturnPct: number;
  readonly walkForwardPassRate: number;
  readonly stressReturnPct: number;
  readonly maxDrawdownPct: number;
  readonly turnoverPct: number;
  readonly significanceProbability: number;
  readonly stabilityScore: number;
  readonly trialCount: number;
}

export interface EvolutionPolicyV1 {
  readonly minimumOosReturnPct: number;
  readonly minimumWalkForwardPassRate: number;
  readonly minimumStressReturnPct: number;
  readonly maximumDrawdownPct: number;
  readonly maximumTurnoverPct: number;
  readonly minimumSignificanceProbability: number;
  readonly minimumStabilityScore: number;
  readonly maximumTrialCount: number;
}

export type PromotionBlockerV1 =
  | 'oos_failed'
  | 'walk_forward_failed'
  | 'stress_failed'
  | 'drawdown_failed'
  | 'turnover_failed'
  | 'significance_failed'
  | 'stability_failed'
  | 'trial_budget_failed';

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
}

export function evaluatePromotionEligibility(
  metrics: EvolutionMetricsV1,
  policy: EvolutionPolicyV1,
): { readonly eligible: boolean; readonly blockers: readonly PromotionBlockerV1[] } {
  for (const [label, value] of Object.entries({ ...metrics, ...policy })) finite(value, label);
  if (!Number.isSafeInteger(metrics.trialCount) || metrics.trialCount < 1 ||
      !Number.isSafeInteger(policy.maximumTrialCount) || policy.maximumTrialCount < 1) {
    throw new TypeError('Trial counts must be positive safe integers.');
  }
  const blockers: PromotionBlockerV1[] = [];
  if (metrics.oosReturnPct < policy.minimumOosReturnPct) blockers.push('oos_failed');
  if (metrics.walkForwardPassRate < policy.minimumWalkForwardPassRate) blockers.push('walk_forward_failed');
  if (metrics.stressReturnPct < policy.minimumStressReturnPct) blockers.push('stress_failed');
  if (metrics.maxDrawdownPct > policy.maximumDrawdownPct) blockers.push('drawdown_failed');
  if (metrics.turnoverPct > policy.maximumTurnoverPct) blockers.push('turnover_failed');
  if (metrics.significanceProbability < policy.minimumSignificanceProbability) blockers.push('significance_failed');
  if (metrics.stabilityScore < policy.minimumStabilityScore) blockers.push('stability_failed');
  if (metrics.trialCount > policy.maximumTrialCount) blockers.push('trial_budget_failed');
  return Object.freeze({ eligible: blockers.length === 0, blockers: Object.freeze(blockers) });
}

export function evolutionDocumentHash(value: CanonicalJsonValue): string {
  return sha256Hex(canonicalJson(value));
}
