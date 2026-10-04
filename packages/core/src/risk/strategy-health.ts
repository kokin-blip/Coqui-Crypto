import { benchmarkRelativeConfidence } from '../research/benchmark-confidence.js';
export interface StrategyHealthPolicy {
  readonly mode: 'observe' | 'qualified'; readonly minimumDays: number; readonly minimumFills: number;
  readonly pauseCostRatio: number; readonly degradedReviewsBeforePause: number;
}
export const OBSERVATION_HEALTH_POLICY: StrategyHealthPolicy = Object.freeze({ mode: 'observe', minimumDays: 90,
  minimumFills: 20, pauseCostRatio: 1.5, degradedReviewsBeforePause: 2 });
export interface StrategyHealthInput {
  readonly days: readonly number[]; readonly netReturns: readonly number[]; readonly benchmarkReturns: readonly number[];
  readonly missingObservations: number; readonly observedModeledCostUsd: number | null;
  readonly observedActualCostUsd: number | null; readonly observedFillCount: number;
  readonly reconciliationExceptions: number; readonly hardSafetyStop: boolean;
}
export interface StrategyHealthReport {
  readonly state: 'observing' | 'watch' | 'degraded' | 'paused'; readonly reasons: readonly string[];
  readonly observedDays: number; readonly missingObservations: number;
  readonly lowerExcess: number | null; readonly upperExcess: number | null;
  readonly costRatio: number | null; readonly consecutiveDegradedReviews: number;
  readonly canGeneratePaperIntents: boolean;
}
export function evaluateStrategyHealth(input: StrategyHealthInput, policy = OBSERVATION_HEALTH_POLICY,
  previous: StrategyHealthReport | null = null): StrategyHealthReport {
  if (!['observe', 'qualified'].includes(policy.mode) ||
      !Number.isSafeInteger(policy.minimumDays) || policy.minimumDays < 90 ||
      !Number.isSafeInteger(policy.minimumFills) || policy.minimumFills < 20 ||
      !Number.isFinite(policy.pauseCostRatio) || policy.pauseCostRatio < 1 ||
      !Number.isSafeInteger(policy.degradedReviewsBeforePause) || policy.degradedReviewsBeforePause < 2) throw new TypeError('Invalid health policy');
  const valid = input.days.length === input.netReturns.length && input.days.length === input.benchmarkReturns.length &&
    [...input.netReturns, ...input.benchmarkReturns].every((v) => Number.isFinite(v) && v > -1) &&
    input.days.every((day, index) => Number.isSafeInteger(day) && day % 86_400_000 === 0 &&
      (index === 0 || day - input.days[index - 1]! === 86_400_000)) &&
    [input.missingObservations, input.observedFillCount, input.reconciliationExceptions].every((v) => Number.isSafeInteger(v) && v >= 0);
  const enough = valid && input.days.length >= policy.minimumDays && input.missingObservations === 0;
  const confidence = enough ? benchmarkRelativeConfidence(input.netReturns, input.benchmarkReturns,
    { resamples: 2000, meanBlockLength: 7, confidenceLevel: 0.95, seed: 86 }) : null;
  const costValid = input.observedModeledCostUsd !== null && input.observedActualCostUsd !== null &&
    Number.isFinite(input.observedModeledCostUsd) && Number.isFinite(input.observedActualCostUsd) &&
    input.observedModeledCostUsd > 0 && input.observedActualCostUsd >= 0 && input.observedFillCount >= policy.minimumFills;
  const costRatio = costValid ? input.observedActualCostUsd! / input.observedModeledCostUsd! : null;
  const reasons: string[] = [];
  if (!enough) reasons.push('insufficient_or_gapped_observations');
  if (input.reconciliationExceptions > 0) reasons.push('reconciliation_exception');
  if (confidence?.upperMeanDailyExcess !== null && confidence?.upperMeanDailyExcess !== undefined && confidence.upperMeanDailyExcess < 0) reasons.push('negative_excess_evidence');
  if (costRatio !== null && costRatio >= policy.pauseCostRatio) reasons.push('observed_cost_drift');
  const degraded = enough && reasons.some((reason) => ['negative_excess_evidence', 'observed_cost_drift'].includes(reason));
  const consecutive = degraded ? (previous?.consecutiveDegradedReviews ?? 0) + 1 : 0;
  const paused = previous?.state === 'paused' || input.hardSafetyStop || (policy.mode === 'qualified' && consecutive >= policy.degradedReviewsBeforePause);
  if (input.hardSafetyStop) reasons.push('hard_safety_stop');
  if (previous?.state === 'paused') reasons.push('explicit_requalification_required');
  return { state: paused ? 'paused' : policy.mode === 'qualified' && degraded ? 'degraded' : reasons.length ? 'watch' : 'observing',
    reasons, observedDays: valid ? input.days.length : 0, missingObservations: input.missingObservations,
    lowerExcess: confidence?.lowerMeanDailyExcess ?? null, upperExcess: confidence?.upperMeanDailyExcess ?? null,
    costRatio, consecutiveDegradedReviews: consecutive, canGeneratePaperIntents: !paused };
}
