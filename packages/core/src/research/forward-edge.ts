import { Decimal } from 'decimal.js';

import { sha256Hex } from '../crypto/sha256.js';
import { deflatedSharpeForTrials, mean, moments, stddev } from '../significance/index.js';
import { benchmarkRelativeConfidence } from './benchmark-confidence.js';

export const FORWARD_EDGE_TRIAL_UPPER_BOUND = 215 as const;

export interface ForwardEdgeStudyPlan {
  readonly formatVersion: 1;
  readonly strategyId: string;
  readonly universe: readonly ['BTC-USD', 'ETH-USD', 'LTC-USD'];
  readonly observation: 'completed_daily_forward_only';
  readonly registeredAtMs: number;
  readonly firstEligibleDayUtcMs: number;
  readonly minimumCompletedDays: 365;
  readonly minimumCostBearingRebalances: 30;
  readonly trialUpperBound: 215;
  readonly costProfileHash: string;
  readonly codeRevision: string;
  readonly noParameterSearch: true;
  readonly noHistoricalBackfill: true;
}

export interface ForwardEdgeEvent {
  readonly atMs: number;
  readonly turnoverUsd: string;
  readonly actualEndingEquityUsd: string;
  readonly noTradeEndingEquityUsd: string;
  readonly recordedCostUsd: string;
  readonly valuationComplete: boolean;
  readonly stateHash: string;
}

export interface ForwardEdgeEventScore {
  readonly grossEdgePct: string;
  readonly costPct: string;
  readonly netEdgePct: string;
}

export interface ForwardEdgeStudyResult {
  readonly planHash: string;
  readonly completedDays: number;
  readonly costBearingRebalances: number;
  readonly completeValuations: boolean;
  readonly grossEdgeLowerConfidenceBoundPct: number | null;
  readonly netEdgeLowerConfidenceBoundPct: number | null;
  readonly excessVsHoldPct: number | null;
  readonly excessVsPassivePct: number | null;
  readonly deflatedSharpeProbability: number | null;
  readonly maximumDrawdownPct: number | null;
  readonly sourceHashes: readonly string[];
  readonly outcome: 'incomplete' | 'passed' | 'failed';
}

export interface ProfitabilityEstimateEvidence {
  readonly grossEdgeLowerBoundPct: number;
  readonly resultHash: string;
  readonly sourceHashes: readonly string[];
  readonly integrityVerified: true;
}

export function canonicalForwardEdgePlan(plan: ForwardEdgeStudyPlan): string {
  return JSON.stringify({
    formatVersion: plan.formatVersion, strategyId: plan.strategyId, universe: plan.universe,
    observation: plan.observation, registeredAtMs: plan.registeredAtMs,
    firstEligibleDayUtcMs: plan.firstEligibleDayUtcMs,
    minimumCompletedDays: plan.minimumCompletedDays,
    minimumCostBearingRebalances: plan.minimumCostBearingRebalances,
    trialUpperBound: plan.trialUpperBound, costProfileHash: plan.costProfileHash,
    codeRevision: plan.codeRevision, noParameterSearch: plan.noParameterSearch,
    noHistoricalBackfill: plan.noHistoricalBackfill,
  });
}

export function hashForwardEdgePlan(plan: ForwardEdgeStudyPlan): string {
  return sha256Hex(canonicalForwardEdgePlan(plan));
}

/** Score one next-interval replay. Recorded costs are subtracted exactly once. */
export function scoreForwardEdgeEvent(event: ForwardEdgeEvent): ForwardEdgeEventScore | null {
  if (!event.valuationComplete) return null;
  const turnover = new Decimal(event.turnoverUsd);
  if (!turnover.isPositive()) return null;
  const grossPnl = new Decimal(event.actualEndingEquityUsd)
    .plus(event.recordedCostUsd)
    .minus(event.noTradeEndingEquityUsd);
  const costPct = new Decimal(event.recordedCostUsd).div(turnover).mul(100);
  const grossEdgePct = grossPnl.div(turnover).mul(100);
  return Object.freeze({
    grossEdgePct: grossEdgePct.toString(),
    costPct: costPct.toString(),
    netEdgePct: grossEdgePct.minus(costPct).toString(),
  });
}

/** Fixed bootstrap configuration makes the confirmatory interval reproducible. */
export function forwardEdgeLowerConfidenceBoundPct(
  netEdgePct: readonly number[],
  seed: number,
): number | null {
  const confidence = benchmarkRelativeConfidence(
    netEdgePct.map((value) => value / 100),
    netEdgePct.map(() => 0),
    { resamples: 2_000, meanBlockLength: 7, confidenceLevel: 0.95, seed },
  );
  return confidence.lowerMeanDailyExcess === null ? null : confidence.lowerMeanDailyExcess * 100;
}

export function forwardEdgeDeflatedSharpeProbability(
  dailyReturns: readonly number[],
  observedTrialSharpes: readonly number[],
): number | null {
  const deviation = stddev([...dailyReturns]);
  if (dailyReturns.length < 2 || deviation === 0) return null;
  const candidateSharpe = mean([...dailyReturns]) / deviation;
  const shape = moments([...dailyReturns]);
  return deflatedSharpeForTrials(candidateSharpe, dailyReturns.length, shape.skew, shape.kurt,
    [...observedTrialSharpes], FORWARD_EDGE_TRIAL_UPPER_BOUND);
}

export function evaluateForwardEdgeResult(
  result: Omit<ForwardEdgeStudyResult, 'outcome'>,
): ForwardEdgeStudyResult {
  const complete = result.completedDays >= 365 && result.costBearingRebalances >= 30 &&
    result.completeValuations && result.sourceHashes.length > 0 &&
    result.grossEdgeLowerConfidenceBoundPct !== null &&
    result.netEdgeLowerConfidenceBoundPct !== null && result.excessVsHoldPct !== null &&
    result.excessVsPassivePct !== null && result.deflatedSharpeProbability !== null &&
    result.maximumDrawdownPct !== null;
  const passed = complete && result.netEdgeLowerConfidenceBoundPct! > 0 &&
    result.excessVsHoldPct! > 0 && result.excessVsPassivePct! > 0 &&
    result.deflatedSharpeProbability! >= 0.95 && result.maximumDrawdownPct! <= 35;
  return Object.freeze({ ...result, outcome: !complete ? 'incomplete' : passed ? 'passed' : 'failed' });
}
