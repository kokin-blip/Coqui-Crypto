import { equityReturns, type StrategyMetrics, type TrackResult } from '../backtest/index.js';
import {
  deflatedSharpeForTrials,
  moments,
  periodSharpe,
  probabilisticSharpe,
} from '../significance/index.js';
import { trialCountForSignificance, type TrialRegistrySnapshot } from '../trials/index.js';
import type { ResearchPreRegistration } from '../validation/pre-registration.js';
import { benchmarkRelativeConfidence, type BenchmarkConfidenceResult } from './benchmark-confidence.js';
import type { CscvPboResult } from './cscv.js';

const START_VALUE = 10_000;

export interface HoldoutAdoptionResult {
  readonly adopted: boolean;
  readonly afterCostReturnPct: number;
  readonly excessReturnVsHoldPct: number;
  readonly excessReturnVsPassivePct: number;
  readonly metrics: StrategyMetrics;
  readonly holdMetrics: StrategyMetrics;
  readonly passiveMetrics: StrategyMetrics;
  readonly benchmarkConfidence: {
    readonly hold: BenchmarkConfidenceResult;
    readonly passive: BenchmarkConfidenceResult;
  };
  readonly psr: number | null;
  readonly dsr: number | null;
  readonly trialCount: number | null;
  readonly checks: {
    readonly positiveVsHold: boolean;
    readonly positiveVsPassive: boolean;
    readonly holdConfidenceAvailable: boolean;
    readonly passiveConfidenceAvailable: boolean;
    readonly holdLowerBoundPositive: boolean;
    readonly passiveLowerBoundPositive: boolean;
    readonly drawdownWithinLimit: boolean;
    readonly significanceAvailable: boolean;
    readonly deflatedSharpePasses: boolean;
    readonly pboAvailable: boolean;
    readonly pboWithinLimit: boolean;
  };
}

function afterCostReturnPct(track: TrackResult): number {
  const last = track.equity.at(-1)?.value;
  return last === undefined ? 0 : (last / START_VALUE - 1) * 100;
}

export function analyzeHoldoutEvidence(input: {
  readonly plan: ResearchPreRegistration;
  readonly registry: TrialRegistrySnapshot;
  readonly pbo: CscvPboResult;
  readonly selectedTrack: TrackResult;
  readonly holdTrack: TrackResult;
  readonly passiveTrack: TrackResult;
  readonly developmentSharpes: readonly number[];
}): HoldoutAdoptionResult {
  const selectedReturn = afterCostReturnPct(input.selectedTrack);
  const excessVsHold = selectedReturn - afterCostReturnPct(input.holdTrack);
  const excessVsPassive = selectedReturn - afterCostReturnPct(input.passiveTrack);
  const returns = equityReturns(input.selectedTrack.equity);
  const holdReturns = equityReturns(input.holdTrack.equity);
  const passiveReturns = equityReturns(input.passiveTrack.equity);
  const bootstrapOptions = {
    resamples: input.plan.validation.bootstrapResamples,
    meanBlockLength: input.plan.validation.bootstrapMeanBlockLength,
    confidenceLevel: input.plan.validation.bootstrapConfidenceLevel,
    seed: input.plan.validation.bootstrapSeed,
  };
  const holdConfidence = benchmarkRelativeConfidence(returns, holdReturns, bootstrapOptions);
  const passiveConfidence = benchmarkRelativeConfidence(
    returns,
    passiveReturns,
    { ...bootstrapOptions, seed: (bootstrapOptions.seed + 1) >>> 0 },
  );
  const observedSharpe = periodSharpe(returns);
  const searchCount = trialCountForSignificance(input.registry);
  const totalTrials = searchCount === null ? null : searchCount + input.plan.candidateCount;
  const distribution = moments(returns);
  const psr = observedSharpe === null ? null : probabilisticSharpe(
    observedSharpe, returns.length, distribution.skew, distribution.kurt, 0,
  );
  const dsr = observedSharpe === null || totalTrials === null ? null : deflatedSharpeForTrials(
    observedSharpe,
    returns.length,
    distribution.skew,
    distribution.kurt,
    [...input.developmentSharpes],
    totalTrials,
  );
  const pboValue = input.pbo.probabilityOfBacktestOverfitting;
  const checks = Object.freeze({
    positiveVsHold: excessVsHold > 0,
    positiveVsPassive: excessVsPassive > 0,
    holdConfidenceAvailable: holdConfidence.status === 'available',
    passiveConfidenceAvailable: passiveConfidence.status === 'available',
    holdLowerBoundPositive:
      holdConfidence.lowerMeanDailyExcess !== null && holdConfidence.lowerMeanDailyExcess > 0,
    passiveLowerBoundPositive:
      passiveConfidence.lowerMeanDailyExcess !== null && passiveConfidence.lowerMeanDailyExcess > 0,
    drawdownWithinLimit:
      Math.abs(Math.min(0, input.selectedTrack.metrics.maxDrawdownPct)) <=
      input.plan.adoptionRules.maximumDrawdownPct,
    significanceAvailable: dsr !== null,
    deflatedSharpePasses:
      dsr !== null && dsr >= input.plan.adoptionRules.minimumDeflatedSharpeProbability,
    pboAvailable: pboValue !== null,
    pboWithinLimit:
      pboValue !== null &&
      pboValue <= input.plan.adoptionRules.maximumProbabilityOfBacktestOverfitting,
  });
  return Object.freeze({
    adopted: Object.values(checks).every(Boolean),
    afterCostReturnPct: selectedReturn,
    excessReturnVsHoldPct: excessVsHold,
    excessReturnVsPassivePct: excessVsPassive,
    metrics: input.selectedTrack.metrics,
    holdMetrics: input.holdTrack.metrics,
    passiveMetrics: input.passiveTrack.metrics,
    benchmarkConfidence: Object.freeze({ hold: holdConfidence, passive: passiveConfidence }),
    psr,
    dsr,
    trialCount: totalTrials,
    checks,
  });
}
