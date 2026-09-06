import type { InstrumentKey } from '../types/index.js';

import {
  DEFAULT_MOMENTUM_CONFIG,
  momentumTargets,
  momentumTargetsAt,
  type MomentumConfig,
  type MomentumTargetResult,
} from './momentum.js';
import {
  DEFAULT_VOL_TARGET_CONFIG,
  volTargetExposure,
  volTargetExposureAt,
  type VolTargetConfig,
} from './vol-target.js';

export interface TrendVolTarget {
  readonly assetId: InstrumentKey;
  readonly weight: number;
}

export interface TrendVolVolatilityEvidence {
  /** Exposure before the optional external modifier is applied. */
  readonly rawExposure: number;
  /** Final aggregate exposure after the optional modifier, always in [0, 1]. */
  readonly exposure: number;
  readonly realizedVolPct: number | null;
  readonly belowTrend: boolean;
}

export interface TrendVolTargetResult {
  readonly targets: readonly TrendVolTarget[];
  readonly cashWeight: number;
  readonly exposure: number;
  readonly momentum: MomentumTargetResult;
  readonly volatility: TrendVolVolatilityEvidence;
  /** Complete only when every configured asset and both volatility windows are observable. */
  readonly historyStatus: 'complete' | 'partial' | 'insufficient';
}

type VolatilityRead = {
  readonly exposure: number;
  readonly realizedVolPct: number | null;
  readonly belowTrend: boolean;
};

/** Completed closes required for every configured TrendVol read to be observable. */
export function trendVolMinimumHistory(
  momentum: MomentumConfig = DEFAULT_MOMENTUM_CONFIG,
  volatility: VolTargetConfig = DEFAULT_VOL_TARGET_CONFIG,
): number {
  const momentumLookback = Math.max(
    momentum.lookbackDays,
    ...(momentum.lookbackDaysEnsemble ?? []),
  ) + 1;
  return Math.max(
    momentumLookback,
    volatility.volLookbackDays + 1,
    volatility.trendGateDays,
  );
}

function normalizedBaseTargets(
  targets: readonly TrendVolTarget[],
): TrendVolTarget[] {
  const clean = targets
    .map((target) => ({ assetId: target.assetId, weight: Math.max(0, target.weight) }))
    .filter((target) => target.assetId && target.weight > 0);
  const sum = clean.reduce((total, target) => total + target.weight, 0);
  return sum <= 0
    ? []
    : clean.map((target) => ({ assetId: target.assetId, weight: target.weight / sum }));
}

function historyStatus(
  baseCount: number,
  momentumCount: number,
  observedDays: number,
  momentum: MomentumConfig,
  volatility: VolTargetConfig,
): TrendVolTargetResult['historyStatus'] {
  const allMomentumAvailable = baseCount > 0 && momentumCount === baseCount;
  if (allMomentumAvailable && observedDays >= trendVolMinimumHistory(momentum, volatility)) {
    return 'complete';
  }
  return momentumCount === 0 || observedDays === 0 ? 'insufficient' : 'partial';
}

/**
 * Compose the two existing deterministic strategy reads. Momentum decides what
 * to own; volatility targeting decides how much aggregate exposure to retain.
 */
export function composeTrendVolTargets(
  baseTargets: readonly TrendVolTarget[],
  momentum: MomentumTargetResult,
  volatility: VolatilityRead,
  exposureScale = 1,
  observedDays = 0,
  momentumConfig: MomentumConfig = DEFAULT_MOMENTUM_CONFIG,
  volTargetConfig: VolTargetConfig = DEFAULT_VOL_TARGET_CONFIG,
): TrendVolTargetResult {
  const base = normalizedBaseTargets(baseTargets);
  const selected = momentum.stats.length > 0 ? momentum.targets : base;
  const scale = Math.max(0, exposureScale);
  const exposure = Math.min(1, volatility.exposure * scale);
  const targets = selected.map((target) => ({
    assetId: target.assetId,
    weight: target.weight * exposure,
  }));
  const invested = targets.reduce((total, target) => total + target.weight, 0);
  return {
    targets: Object.freeze(targets),
    cashWeight: Math.max(0, 1 - invested),
    exposure,
    momentum,
    volatility: {
      rawExposure: volatility.exposure,
      exposure,
      realizedVolPct: volatility.realizedVolPct,
      belowTrend: volatility.belowTrend,
    },
    historyStatus: historyStatus(
      base.length,
      momentum.stats.length,
      observedDays,
      momentumConfig,
      volTargetConfig,
    ),
  };
}

/** Evaluate current targets from complete close histories, most recent last. */
export function trendVolTargets(
  baseTargets: readonly TrendVolTarget[],
  closesById: Partial<Record<InstrumentKey, number[]>>,
  mixCloses: number[],
  options: {
    readonly momentum?: MomentumConfig;
    readonly volTarget?: VolTargetConfig;
    readonly exposureScale?: number;
  } = {},
): TrendVolTargetResult {
  const momentumConfig = options.momentum ?? DEFAULT_MOMENTUM_CONFIG;
  const volTargetConfig = options.volTarget ?? DEFAULT_VOL_TARGET_CONFIG;
  return composeTrendVolTargets(
    baseTargets,
    momentumTargets([...baseTargets], closesById, momentumConfig),
    volTargetExposure(mixCloses, volTargetConfig),
    options.exposureScale,
    mixCloses.length,
    momentumConfig,
    volTargetConfig,
  );
}

/** Indexed form used by chronological research and backtests without prefix copies. */
export function trendVolTargetsAt(
  baseTargets: readonly TrendVolTarget[],
  closesById: ReadonlyMap<InstrumentKey, readonly number[]>,
  mixCloses: readonly number[],
  endExclusive: number,
  options: {
    readonly momentum?: MomentumConfig;
    readonly volTarget?: VolTargetConfig;
    readonly exposureScale?: number;
  } = {},
): TrendVolTargetResult {
  const momentumConfig = options.momentum ?? DEFAULT_MOMENTUM_CONFIG;
  const volTargetConfig = options.volTarget ?? DEFAULT_VOL_TARGET_CONFIG;
  return composeTrendVolTargets(
    baseTargets,
    momentumTargetsAt([...baseTargets], closesById, endExclusive, momentumConfig),
    volTargetExposureAt(mixCloses, endExclusive, volTargetConfig),
    options.exposureScale,
    Math.min(Math.max(0, endExclusive), mixCloses.length),
    momentumConfig,
    volTargetConfig,
  );
}
