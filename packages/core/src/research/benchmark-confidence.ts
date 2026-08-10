import { mulberry32, stationaryBootstrapIndices } from '../validation/monte-carlo.js';

export interface BenchmarkConfidenceOptions {
  readonly resamples: number;
  readonly meanBlockLength: number;
  readonly confidenceLevel: number;
  readonly seed: number;
}

export interface BenchmarkConfidenceResult {
  readonly status: 'available' | 'insufficient-data';
  readonly reason: string | null;
  readonly observations: number;
  readonly resamples: number;
  readonly meanBlockLength: number;
  readonly confidenceLevel: number;
  readonly observedMeanDailyExcess: number | null;
  readonly annualizedArithmeticExcessPct: number | null;
  readonly lowerMeanDailyExcess: number | null;
  readonly upperMeanDailyExcess: number | null;
  readonly oneSidedPValue: number | null;
}

function unavailable(
  reason: string,
  observations: number,
  options: BenchmarkConfidenceOptions,
): BenchmarkConfidenceResult {
  return Object.freeze({
    status: 'insufficient-data',
    reason,
    observations,
    resamples: 0,
    meanBlockLength: options.meanBlockLength,
    confidenceLevel: options.confidenceLevel,
    observedMeanDailyExcess: null,
    annualizedArithmeticExcessPct: null,
    lowerMeanDailyExcess: null,
    upperMeanDailyExcess: null,
    oneSidedPValue: null,
  });
}

function quantile(sorted: readonly number[], probability: number): number {
  const position = probability * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const fraction = position - lower;
  return sorted[lower]! * (1 - fraction) + sorted[upper]! * fraction;
}

/** Paired stationary-bootstrap interval and null-centered one-sided p-value. */
export function benchmarkRelativeConfidence(
  strategyReturns: readonly number[],
  benchmarkReturns: readonly number[],
  options: BenchmarkConfidenceOptions,
): BenchmarkConfidenceResult {
  const observations = strategyReturns.length;
  if (observations !== benchmarkReturns.length) {
    return unavailable('Strategy and benchmark returns must be synchronous.', observations, options);
  }
  if (observations < 30) {
    return unavailable('At least 30 paired daily returns are required.', observations, options);
  }
  if (strategyReturns.some((value) => !Number.isFinite(value)) ||
      benchmarkReturns.some((value) => !Number.isFinite(value))) {
    return unavailable('Strategy and benchmark returns must all be finite.', observations, options);
  }
  if (!Number.isSafeInteger(options.resamples) || options.resamples < 500 ||
      !Number.isSafeInteger(options.meanBlockLength) || options.meanBlockLength < 1 ||
      options.meanBlockLength > observations ||
      !Number.isFinite(options.confidenceLevel) || options.confidenceLevel <= 0.5 ||
      options.confidenceLevel >= 1 ||
      !Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffff_ffff) {
    return unavailable('Bootstrap options are invalid for the paired sample.', observations, options);
  }
  const excess = strategyReturns.map((value, index) => value - benchmarkReturns[index]!);
  const observed = excess.reduce((sum, value) => sum + value, 0) / observations;
  const centered = excess.map((value) => value - observed);
  const random = mulberry32(options.seed);
  const bootstrapMeans: number[] = [];
  let nullAtLeastObserved = 0;
  for (let sample = 0; sample < options.resamples; sample += 1) {
    const indices = stationaryBootstrapIndices(
      observations,
      observations,
      options.meanBlockLength,
      random,
    );
    let rawSum = 0;
    let nullSum = 0;
    for (const index of indices) {
      rawSum += excess[index]!;
      nullSum += centered[index]!;
    }
    bootstrapMeans.push(rawSum / observations);
    if (nullSum / observations >= observed) nullAtLeastObserved += 1;
  }
  bootstrapMeans.sort((left, right) => left - right);
  const tail = (1 - options.confidenceLevel) / 2;
  return Object.freeze({
    status: 'available',
    reason: null,
    observations,
    resamples: options.resamples,
    meanBlockLength: options.meanBlockLength,
    confidenceLevel: options.confidenceLevel,
    observedMeanDailyExcess: observed,
    annualizedArithmeticExcessPct: observed * 365 * 100,
    lowerMeanDailyExcess: quantile(bootstrapMeans, tail),
    upperMeanDailyExcess: quantile(bootstrapMeans, 1 - tail),
    oneSidedPValue: (nullAtLeastObserved + 1) / (options.resamples + 1),
  });
}
