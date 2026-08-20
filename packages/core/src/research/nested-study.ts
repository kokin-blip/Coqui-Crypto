import {
  equityReturns,
  type TrackResult,
} from '../backtest/index.js';
import type { TradeCostConfig } from '../costs/index.js';
import {
  buildDecisionMarketDataset,
  type DecisionMarketDataset,
} from '../market/index.js';
import { sha256Hex } from '../crypto/sha256.js';
import {
  DEFAULT_MOMENTUM_CONFIG,
  DEFAULT_VOL_TARGET_CONFIG,
  type MomentumConfig,
  type VolTargetConfig,
} from '../strategies/index.js';
import type { JsonValue, TrialRegistrySnapshot } from '../trials/index.js';
import type { InstrumentKey } from '../types/index.js';
import {
  canonicalResearchPreRegistration,
  type ResearchPreRegistration,
} from '../validation/pre-registration.js';
import {
  combinatoriallySymmetricCrossValidation,
  type CscvPboResult,
} from './cscv.js';
import { analyzeHoldoutEvidence, type HoldoutAdoptionResult } from './holdout-evidence.js';
import {
  evaluateTrendVolResearch,
  type TrendVolResearchTracks,
} from './trendvol-evaluator.js';

const DAY_MS = 86_400_000;
const START_VALUE = 10_000;
const ALLOWED_PARAMETERS = new Set([
  'belowTrendMaxExposure', 'defensiveScale', 'lookbackDays', 'maxExposure',
  'maxRelativeTilt', 'minExposure', 'rebalanceEveryDays', 'targetVolatilityPct',
  'targetVolPct', 'trendGateDays', 'volatilityDays', 'volLookbackDays',
]);

export interface ResearchCandidate {
  readonly id: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
}

export interface CandidateScore {
  readonly candidate: ResearchCandidate;
  readonly validationSegments: number;
  readonly afterCostReturnPct: number;
  readonly excessReturnVsHoldPct: number;
  readonly excessReturnVsPassivePct: number;
  readonly sharpe: number | null;
  readonly maxDrawdownPct: number;
}

export interface NestedChronologicalFoldResult {
  readonly fold: number;
  readonly trainingEndExclusiveMs: number;
  readonly validationStartMs: number;
  readonly validationEndExclusiveMs: number;
  readonly selectedCandidateId: string;
  readonly selectedExcessReturnVsHoldPct: number;
  readonly selectedExcessReturnVsPassivePct: number;
}

export interface NestedChronologicalStudyResult {
  readonly planId: string;
  readonly datasetHash: string;
  readonly candidateCount: number;
  readonly candidates: readonly ResearchCandidate[];
  readonly developmentScores: readonly CandidateScore[];
  readonly folds: readonly NestedChronologicalFoldResult[];
  readonly selectedCandidate: ResearchCandidate;
  readonly pbo: CscvPboResult;
  readonly holdout: HoldoutAdoptionResult;
}

function canonicalParameters(parameters: Readonly<Record<string, JsonValue>>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(parameters).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0)));
}

/** Enumerate a frozen Cartesian grid in deterministic parameter/value order. */
export function expandResearchGrid(plan: ResearchPreRegistration): readonly ResearchCandidate[] {
  canonicalResearchPreRegistration(plan);
  const entries = Object.entries(plan.parameterSpace).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0);
  for (const [parameter] of entries) {
    if (!ALLOWED_PARAMETERS.has(parameter)) {
      throw new TypeError(`Unsupported trend-vol research parameter: ${parameter}`);
    }
  }
  const candidates: ResearchCandidate[] = [];
  const visit = (index: number, parameters: Record<string, JsonValue>): void => {
    if (index === entries.length) {
      const frozen = Object.freeze({ ...parameters });
      candidates.push(Object.freeze({
        id: sha256Hex(canonicalParameters(frozen)),
        parameters: frozen,
      }));
      return;
    }
    const [name, values] = entries[index]!;
    for (const value of values) visit(index + 1, { ...parameters, [name]: value });
  };
  visit(0, {});
  if (candidates.length !== plan.candidateCount) {
    throw new Error('Expanded candidate count differs from the pre-registration.');
  }
  return Object.freeze(candidates);
}

function numeric(candidate: ResearchCandidate, key: string, fallback: number): number {
  const value = candidate.parameters[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Research parameter must be a finite number: ${key}`);
  }
  return value;
}

function positiveInteger(candidate: ResearchCandidate, key: string, fallback: number): number {
  const value = numeric(candidate, key, fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`Research parameter must be a positive integer: ${key}`);
  }
  return value;
}

function fraction(candidate: ResearchCandidate, key: string, fallback: number): number {
  const value = numeric(candidate, key, fallback);
  if (value < 0 || value > 1) throw new RangeError(`Research parameter must be in [0, 1]: ${key}`);
  return value;
}

function candidateOptions(candidate: ResearchCandidate): {
  rebalanceEveryDays: number;
  momentum: MomentumConfig;
  volTarget: VolTargetConfig;
} {
  return {
    rebalanceEveryDays: positiveInteger(candidate, 'rebalanceEveryDays', 14),
    momentum: {
      lookbackDays: positiveInteger(candidate, 'lookbackDays', DEFAULT_MOMENTUM_CONFIG.lookbackDays),
      volatilityDays: positiveInteger(
        candidate, 'volatilityDays', DEFAULT_MOMENTUM_CONFIG.volatilityDays,
      ),
      maxRelativeTilt: fraction(
        candidate, 'maxRelativeTilt', DEFAULT_MOMENTUM_CONFIG.maxRelativeTilt,
      ),
      defensiveScale: fraction(
        candidate, 'defensiveScale', DEFAULT_MOMENTUM_CONFIG.defensiveScale,
      ),
      targetVolatilityPct: numeric(
        candidate, 'targetVolatilityPct', DEFAULT_MOMENTUM_CONFIG.targetVolatilityPct,
      ),
    },
    volTarget: {
      targetVolPct: numeric(candidate, 'targetVolPct', DEFAULT_VOL_TARGET_CONFIG.targetVolPct),
      volLookbackDays: positiveInteger(
        candidate, 'volLookbackDays', DEFAULT_VOL_TARGET_CONFIG.volLookbackDays,
      ),
      minExposure: fraction(candidate, 'minExposure', DEFAULT_VOL_TARGET_CONFIG.minExposure),
      maxExposure: fraction(candidate, 'maxExposure', DEFAULT_VOL_TARGET_CONFIG.maxExposure),
      trendGateDays: positiveInteger(
        candidate, 'trendGateDays', DEFAULT_VOL_TARGET_CONFIG.trendGateDays,
      ),
      belowTrendMaxExposure: fraction(
        candidate, 'belowTrendMaxExposure', DEFAULT_VOL_TARGET_CONFIG.belowTrendMaxExposure,
      ),
    },
  };
}

function sliceDataset(
  dataset: DecisionMarketDataset,
  startIndex: number,
  endIndex: number,
): DecisionMarketDataset {
  const input = Object.fromEntries(dataset.assets.map((assetId) => [
    assetId,
    (dataset.barsById[assetId] ?? []).slice(startIndex, endIndex),
  ]));
  return buildDecisionMarketDataset(input, dataset.assets, {
    policy: 'reject-on-gap',
    nowMs: dataset.generatedAtMs,
  });
}

function windowIndices(
  dataset: DecisionMarketDataset,
  startMs: number,
  endExclusiveMs: number,
): { start: number; end: number } {
  const startKey = new Date(startMs).toISOString().slice(0, 10);
  const endKey = new Date(endExclusiveMs - DAY_MS).toISOString().slice(0, 10);
  const start = dataset.dayKeys.indexOf(startKey);
  const last = dataset.dayKeys.indexOf(endKey);
  const expected = (endExclusiveMs - startMs) / DAY_MS;
  if (start < 0 || last < start || last - start + 1 !== expected) {
    throw new Error('Dataset does not provide contiguous coverage for a registered window.');
  }
  return { start, end: last + 1 };
}

function runCandidate(
  dataset: DecisionMarketDataset,
  scoreStartIndex: number,
  plan: ResearchPreRegistration,
  candidate: ResearchCandidate,
  tradeCosts: TradeCostConfig,
): TrendVolResearchTracks {
  const options = candidateOptions(candidate);
  if (options.momentum.targetVolatilityPct <= 0 || options.volTarget.targetVolPct <= 0 ||
      options.volTarget.minExposure > options.volTarget.maxExposure) {
    throw new RangeError('Candidate volatility and exposure parameters are inconsistent.');
  }
  return evaluateTrendVolResearch(
    dataset,
    plan.execution.baseTargets.map((target) => ({
      assetId: target.assetId as InstrumentKey,
      weight: target.weight,
    })),
    {
      warmup: scoreStartIndex,
      rebalanceEveryDays: options.rebalanceEveryDays,
      momentum: options.momentum,
      volTarget: options.volTarget,
      tradeCosts,
      cashAprPct: plan.execution.cashAprPct,
    },
  );
}

function afterCostReturnPct(track: TrackResult): number {
  const last = track.equity.at(-1)?.value;
  return last === undefined ? 0 : (last / START_VALUE - 1) * 100;
}

function trackForFamily(result: TrendVolResearchTracks, family: ResearchPreRegistration['family']): TrackResult {
  if (family !== 'trendvol') throw new TypeError('The first nested runner supports trendvol only.');
  return result.trendvol;
}

function score(
  result: TrendVolResearchTracks,
  candidate: ResearchCandidate,
  family: ResearchPreRegistration['family'],
): CandidateScore {
  const track = trackForFamily(result, family);
  const afterCosts = afterCostReturnPct(track);
  return Object.freeze({
    candidate,
    validationSegments: 1,
    afterCostReturnPct: afterCosts,
    excessReturnVsHoldPct: afterCosts - afterCostReturnPct(result.hold),
    excessReturnVsPassivePct: afterCosts - afterCostReturnPct(result.passive),
    sharpe: track.metrics.sharpe,
    maxDrawdownPct: track.metrics.maxDrawdownPct,
  });
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Inner chronological validation used for parameter choice inside each outer fold. */
function crossValidatedScores(
  dataset: DecisionMarketDataset,
  endExclusiveIndex: number,
  plan: ResearchPreRegistration,
  candidates: readonly ResearchCandidate[],
  tradeCosts: TradeCostConfig,
): CandidateScore[] {
  const scorableBars = endExclusiveIndex - plan.execution.warmupBars;
  if (scorableBars < plan.validation.nestedFoldCount * 2) {
    throw new Error('Inner chronological validation has fewer than two bars per segment.');
  }
  return candidates.map((candidate) => {
    const segments: CandidateScore[] = [];
    for (let segment = 0; segment < plan.validation.nestedFoldCount; segment += 1) {
      const start = plan.execution.warmupBars +
        Math.floor((segment * scorableBars) / plan.validation.nestedFoldCount);
      const end = segment === plan.validation.nestedFoldCount - 1
        ? endExclusiveIndex
        : plan.execution.warmupBars +
          Math.floor(((segment + 1) * scorableBars) / plan.validation.nestedFoldCount);
      const throughSegment = sliceDataset(dataset, 0, end);
      segments.push(score(
        runCandidate(throughSegment, start, plan, candidate, tradeCosts),
        candidate,
        plan.family,
      ));
    }
    const sharpes = segments.flatMap((item) => item.sharpe === null ? [] : [item.sharpe]);
    return Object.freeze({
      candidate,
      validationSegments: segments.length,
      afterCostReturnPct: mean(segments.map((item) => item.afterCostReturnPct)),
      excessReturnVsHoldPct: mean(segments.map((item) => item.excessReturnVsHoldPct)),
      excessReturnVsPassivePct: mean(segments.map((item) => item.excessReturnVsPassivePct)),
      sharpe: sharpes.length === 0 ? null : mean(sharpes),
      maxDrawdownPct: Math.min(...segments.map((item) => item.maxDrawdownPct)),
    });
  });
}

function best(scores: readonly CandidateScore[]): CandidateScore {
  if (scores.length === 0) throw new Error('No research candidates were evaluated.');
  return scores.reduce((leader, item) =>
    item.excessReturnVsHoldPct > leader.excessReturnVsHoldPct ? item : leader);
}

/** Run selection on development only, then open the final holdout exactly once. */
export function runNestedChronologicalStudy(
  plan: ResearchPreRegistration,
  dataset: DecisionMarketDataset,
  tradeCosts: TradeCostConfig,
  registry: TrialRegistrySnapshot,
): NestedChronologicalStudyResult {
  canonicalResearchPreRegistration(plan);
  if (plan.family !== 'trendvol') throw new TypeError('The first nested runner supports trendvol only.');
  if (dataset.report.datasetHash !== plan.datasetHash) {
    throw new Error('Decision dataset hash does not match the pre-registered dataset.');
  }
  for (const target of plan.execution.baseTargets) {
    if (!dataset.assets.includes(target.assetId as InstrumentKey)) {
      throw new Error(`Pre-registered base target is absent from the dataset: ${target.assetId}`);
    }
  }
  const development = windowIndices(
    dataset, plan.validation.development.startMs, plan.validation.development.endExclusiveMs,
  );
  const holdout = windowIndices(
    dataset, plan.validation.holdout.startMs, plan.validation.holdout.endExclusiveMs,
  );
  const developmentBars = development.end - development.start;
  const holdoutBars = holdout.end - holdout.start;
  if (developmentBars < plan.validation.minimumDevelopmentBars ||
      holdoutBars < plan.validation.minimumHoldoutBars) {
    throw new Error('Dataset does not meet pre-registered minimum bar counts.');
  }
  const developmentDataset = sliceDataset(dataset, development.start, development.end);
  const candidates = expandResearchGrid(plan);
  const foldResults: NestedChronologicalFoldResult[] = [];
  for (let fold = 1; fold < plan.validation.nestedFoldCount; fold += 1) {
    const validationStart = Math.floor((fold * developmentBars) / plan.validation.nestedFoldCount);
    const validationEnd = fold === plan.validation.nestedFoldCount - 1
      ? developmentBars
      : Math.floor(((fold + 1) * developmentBars) / plan.validation.nestedFoldCount);
    const trainingEnd = validationStart - plan.validation.embargoDays;
    if (trainingEnd <= plan.execution.warmupBars + 1) {
      throw new Error('First chronological training fold is too short after warmup and embargo.');
    }
    const trainingScores = crossValidatedScores(
      developmentDataset,
      trainingEnd,
      plan,
      candidates,
      tradeCosts,
    );
    const selected = best(trainingScores).candidate;
    const throughValidation = sliceDataset(developmentDataset, 0, validationEnd);
    const validationScore = score(
      runCandidate(throughValidation, validationStart, plan, selected, tradeCosts),
      selected,
      plan.family,
    );
    foldResults.push(Object.freeze({
      fold,
      trainingEndExclusiveMs: plan.validation.development.startMs + trainingEnd * DAY_MS,
      validationStartMs: plan.validation.development.startMs + validationStart * DAY_MS,
      validationEndExclusiveMs: plan.validation.development.startMs + validationEnd * DAY_MS,
      selectedCandidateId: selected.id,
      selectedExcessReturnVsHoldPct: validationScore.excessReturnVsHoldPct,
      selectedExcessReturnVsPassivePct: validationScore.excessReturnVsPassivePct,
    }));
  }

  const developmentScores = crossValidatedScores(
    developmentDataset,
    developmentBars,
    plan,
    candidates,
    tradeCosts,
  );
  const selectedCandidate = best(developmentScores).candidate;
  const candidateDevelopmentReturns = candidates.map((candidate) => {
    const run = runCandidate(
      developmentDataset,
      plan.execution.warmupBars,
      plan,
      candidate,
      tradeCosts,
    );
    return equityReturns(trackForFamily(run, plan.family).equity);
  });
  const pbo = combinatoriallySymmetricCrossValidation(
    candidateDevelopmentReturns,
    plan.validation.cscvPartitionCount,
  );

  const throughHoldout = sliceDataset(dataset, development.start, holdout.end);
  const holdoutStartIndex = holdout.start - development.start;
  const holdoutRun = runCandidate(
    throughHoldout, holdoutStartIndex, plan, selectedCandidate, tradeCosts,
  );
  const selectedTrack = trackForFamily(holdoutRun, plan.family);
  const developmentSharpes = developmentScores.flatMap((item) =>
    item.sharpe === null ? [] : [item.sharpe / Math.sqrt(365)]);
  const holdoutResult = analyzeHoldoutEvidence({
    plan,
    registry,
    pbo,
    selectedTrack,
    holdTrack: holdoutRun.hold,
    passiveTrack: holdoutRun.passive,
    developmentSharpes,
  });
  return Object.freeze({
    planId: plan.id,
    datasetHash: plan.datasetHash,
    candidateCount: candidates.length,
    candidates,
    developmentScores: Object.freeze(developmentScores),
    folds: Object.freeze(foldResults),
    selectedCandidate,
    pbo,
    holdout: holdoutResult,
  });
}
