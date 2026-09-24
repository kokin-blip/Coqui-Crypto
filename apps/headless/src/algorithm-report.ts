import {
  DEFAULT_MOMENTUM_CONFIG,
  DEFAULT_VOL_TARGET_CONFIG,
  trendVolMinimumHistory,
  trendVolTargets,
  type InstrumentKey,
  type TrendVolTarget,
} from '@coqui/core';

export interface AlgorithmSnapshot {
  readonly baseTargets: readonly TrendVolTarget[];
  readonly closesById: Partial<Record<InstrumentKey, number[]>>;
  readonly mixCloses: readonly number[];
  readonly exposureScale?: number;
}

function positiveSeries(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(
    (item) => typeof item === 'number' && Number.isFinite(item) && item > 0,
  );
}

export function parseAlgorithmSnapshot(value: unknown): AlgorithmSnapshot {
  if (value === null || typeof value !== 'object') throw new Error('input_must_be_an_object');
  const candidate = value as Partial<AlgorithmSnapshot>;
  if (!Array.isArray(candidate.baseTargets) || candidate.baseTargets.length === 0) {
    throw new Error('baseTargets_must_be_non_empty');
  }
  if (candidate.closesById === null || typeof candidate.closesById !== 'object') {
    throw new Error('closesById_must_be_an_object');
  }
  if (!positiveSeries(candidate.mixCloses)) throw new Error('mixCloses_must_be_positive_prices');
  for (const target of candidate.baseTargets) {
    if (target === null || typeof target !== 'object' || typeof target.assetId !== 'string' ||
      typeof target.weight !== 'number' || !Number.isFinite(target.weight) || target.weight < 0) {
      throw new Error('invalid_base_target');
    }
    if (!positiveSeries(candidate.closesById[target.assetId])) {
      throw new Error(`missing_or_invalid_closes:${target.assetId}`);
    }
  }
  if (candidate.exposureScale !== undefined &&
    (!Number.isFinite(candidate.exposureScale) || candidate.exposureScale < 0)) {
    throw new Error('exposureScale_must_be_non_negative');
  }
  return candidate as AlgorithmSnapshot;
}

export function createAlgorithmReport(snapshot: AlgorithmSnapshot) {
  const options = snapshot.exposureScale === undefined
    ? {}
    : { exposureScale: snapshot.exposureScale };
  const result = trendVolTargets(
    snapshot.baseTargets,
    snapshot.closesById,
    [...snapshot.mixCloses],
    options,
  );
  const observations = snapshot.mixCloses.length;
  const historyNeeded = trendVolMinimumHistory();
  const stats = result.momentum.stats.map((stat) => ({
    assetId: stat.assetId,
    returnPct: stat.returnPct,
    volatilityPct: stat.volatilityPct,
    riskAdjustedMomentum: stat.riskAdjustedMomentum,
  }));
  const volatility = result.volatility.realizedVolPct === null
    ? 'unavailable'
    : `${result.volatility.realizedVolPct.toFixed(2)}% realized`;
  const trace = [
    'Strategy: TrendVol (momentum selection + volatility exposure)',
    `Input: ${observations} mix closes; minimum history is ${historyNeeded}`,
    `History: ${result.historyStatus}`,
    stats.length === 0
      ? 'Momentum: insufficient history, so the base allocation is retained.'
      : `Momentum: evaluated ${stats.length} assets; targets reflect risk-adjusted momentum.`,
    `Volatility: ${volatility}; ${result.volatility.belowTrend ? 'below' : 'above'} trend gate.`,
    `Decision: ${result.exposure.toFixed(4)} invested, ${result.cashWeight.toFixed(4)} cash.`,
  ];
  return {
    strategy: 'trendvol-exploratory-paper-v1',
    input: { assets: snapshot.baseTargets.map(({ assetId }) => assetId), observations },
    config: { momentum: DEFAULT_MOMENTUM_CONFIG, volatility: DEFAULT_VOL_TARGET_CONFIG },
    decision: result,
    stats,
    trace,
  };
}
