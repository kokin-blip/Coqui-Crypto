/**
 * Combinatorially Symmetric Cross-Validation (Bailey et al.).
 *
 * Input columns are synchronous, after-cost candidate return series. The oldest
 * remainder is excluded when observations do not divide evenly so every CSCV
 * partition has identical dimensions; that deterministic choice is reported.
 */

export interface CscvSplitObservation {
  readonly selectedCandidateIndex: number;
  readonly inSamplePerformance: number;
  readonly outOfSamplePerformance: number;
  readonly outOfSampleRelativeRank: number;
  readonly logit: number;
}

export interface CscvPboResult {
  readonly status: 'available' | 'insufficient-data';
  readonly reason: string | null;
  readonly candidateCount: number;
  readonly observationCount: number;
  readonly usableObservationCount: number;
  readonly droppedOldestObservations: number;
  readonly partitionCount: number;
  readonly combinationCount: number;
  readonly probabilityOfBacktestOverfitting: number | null;
  readonly probabilityOfOutOfSampleLoss: number | null;
  readonly performanceDegradationSlope: number | null;
  readonly meanInSamplePerformance: number | null;
  readonly meanOutOfSamplePerformance: number | null;
  readonly splits: readonly CscvSplitObservation[];
}

interface ReturnStats {
  count: number;
  sum: number;
  sumSquares: number;
}

function unavailable(
  reason: string,
  candidateCount: number,
  observationCount: number,
  partitionCount: number,
): CscvPboResult {
  return Object.freeze({
    status: 'insufficient-data',
    reason,
    candidateCount,
    observationCount,
    usableObservationCount: 0,
    droppedOldestObservations: 0,
    partitionCount,
    combinationCount: 0,
    probabilityOfBacktestOverfitting: null,
    probabilityOfOutOfSampleLoss: null,
    performanceDegradationSlope: null,
    meanInSamplePerformance: null,
    meanOutOfSamplePerformance: null,
    splits: Object.freeze([]),
  });
}

function combinations(n: number, choose: number): number[][] {
  const output: number[][] = [];
  const visit = (next: number, selected: number[]): void => {
    if (selected.length === choose) {
      output.push([...selected]);
      return;
    }
    const needed = choose - selected.length;
    for (let value = next; value <= n - needed; value += 1) {
      selected.push(value);
      visit(value + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return output;
}

function addStats(left: ReturnStats, right: ReturnStats): ReturnStats {
  return {
    count: left.count + right.count,
    sum: left.sum + right.sum,
    sumSquares: left.sumSquares + right.sumSquares,
  };
}

function subtractStats(total: ReturnStats, part: ReturnStats): ReturnStats {
  return {
    count: total.count - part.count,
    sum: total.sum - part.sum,
    sumSquares: total.sumSquares - part.sumSquares,
  };
}

function sharpe(stats: ReturnStats): number {
  if (stats.count < 2) return 0;
  const mean = stats.sum / stats.count;
  const numerator = stats.sumSquares - (stats.sum * stats.sum) / stats.count;
  const variance = Math.max(0, numerator / (stats.count - 1));
  if (variance === 0) {
    if (mean > 0) return Number.MAX_SAFE_INTEGER;
    if (mean < 0) return -Number.MAX_SAFE_INTEGER;
    return 0;
  }
  return mean / Math.sqrt(variance);
}

/** Rank from 1 (worst) through N (best), averaging exact ties. */
function rank(values: readonly number[], selectedIndex: number): number {
  const selected = values[selectedIndex]!;
  let lower = 0;
  let equal = 0;
  for (const value of values) {
    if (value < selected) lower += 1;
    else if (value === selected) equal += 1;
  }
  return lower + (equal + 1) / 2;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function regressionSlope(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const xMean = mean(xs);
  const yMean = mean(ys);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const xDelta = xs[index]! - xMean;
    numerator += xDelta * (ys[index]! - yMean);
    denominator += xDelta * xDelta;
  }
  return denominator > 0 ? numerator / denominator : null;
}

/** Estimate PBO from synchronous candidate return columns using every symmetric split. */
export function combinatoriallySymmetricCrossValidation(
  returnsByCandidate: readonly (readonly number[])[],
  partitionCount: number,
): CscvPboResult {
  const candidateCount = returnsByCandidate.length;
  const observationCount = returnsByCandidate[0]?.length ?? 0;
  if (!Number.isSafeInteger(partitionCount) || partitionCount < 4 ||
      partitionCount > 18 || partitionCount % 2 !== 0) {
    return unavailable('CSCV requires an even partition count from 4 through 18.',
      candidateCount, observationCount, partitionCount);
  }
  if (candidateCount < 2) {
    return unavailable('CSCV requires at least two candidate return series.',
      candidateCount, observationCount, partitionCount);
  }
  if (returnsByCandidate.some((returns) => returns.length !== observationCount)) {
    return unavailable('CSCV candidate return series must be synchronous and equal length.',
      candidateCount, observationCount, partitionCount);
  }
  if (returnsByCandidate.some((returns) => returns.some((value) => !Number.isFinite(value)))) {
    return unavailable('CSCV candidate returns must all be finite.',
      candidateCount, observationCount, partitionCount);
  }
  const partitionSize = Math.floor(observationCount / partitionCount);
  if (partitionSize < 2) {
    return unavailable('CSCV requires at least two observations per partition.',
      candidateCount, observationCount, partitionCount);
  }
  const usableObservationCount = partitionSize * partitionCount;
  const droppedOldestObservations = observationCount - usableObservationCount;
  const partitionStats: ReturnStats[][] = Array.from(
    { length: partitionCount },
    () => Array.from({ length: candidateCount }, () => ({ count: 0, sum: 0, sumSquares: 0 })),
  );
  const totals: ReturnStats[] = Array.from(
    { length: candidateCount },
    () => ({ count: 0, sum: 0, sumSquares: 0 }),
  );
  for (let partition = 0; partition < partitionCount; partition += 1) {
    const from = droppedOldestObservations + partition * partitionSize;
    const to = from + partitionSize;
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      let sum = 0;
      let sumSquares = 0;
      for (let row = from; row < to; row += 1) {
        const value = returnsByCandidate[candidate]![row]!;
        sum += value;
        sumSquares += value * value;
      }
      const stats = { count: partitionSize, sum, sumSquares };
      partitionStats[partition]![candidate] = stats;
      totals[candidate] = addStats(totals[candidate]!, stats);
    }
  }

  const splitObservations: CscvSplitObservation[] = [];
  for (const inSamplePartitions of combinations(partitionCount, partitionCount / 2)) {
    const inSamplePerformance: number[] = [];
    const outOfSamplePerformance: number[] = [];
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      let inSample: ReturnStats = { count: 0, sum: 0, sumSquares: 0 };
      for (const partition of inSamplePartitions) {
        inSample = addStats(inSample, partitionStats[partition]![candidate]!);
      }
      inSamplePerformance.push(sharpe(inSample));
      outOfSamplePerformance.push(sharpe(subtractStats(totals[candidate]!, inSample)));
    }
    let selectedCandidateIndex = 0;
    for (let candidate = 1; candidate < candidateCount; candidate += 1) {
      if (inSamplePerformance[candidate]! > inSamplePerformance[selectedCandidateIndex]!) {
        selectedCandidateIndex = candidate;
      }
    }
    const relativeRank = rank(outOfSamplePerformance, selectedCandidateIndex) /
      (candidateCount + 1);
    splitObservations.push(Object.freeze({
      selectedCandidateIndex,
      inSamplePerformance: inSamplePerformance[selectedCandidateIndex]!,
      outOfSamplePerformance: outOfSamplePerformance[selectedCandidateIndex]!,
      outOfSampleRelativeRank: relativeRank,
      logit: Math.log(relativeRank / (1 - relativeRank)),
    }));
  }
  const inSample = splitObservations.map((split) => split.inSamplePerformance);
  const outOfSample = splitObservations.map((split) => split.outOfSamplePerformance);
  return Object.freeze({
    status: 'available',
    reason: null,
    candidateCount,
    observationCount,
    usableObservationCount,
    droppedOldestObservations,
    partitionCount,
    combinationCount: splitObservations.length,
    probabilityOfBacktestOverfitting:
      splitObservations.filter((split) => split.logit < 0).length / splitObservations.length,
    probabilityOfOutOfSampleLoss:
      splitObservations.filter((split) => split.outOfSamplePerformance < 0).length /
      splitObservations.length,
    performanceDegradationSlope: regressionSlope(inSample, outOfSample),
    meanInSamplePerformance: mean(inSample),
    meanOutOfSamplePerformance: mean(outOfSample),
    splits: Object.freeze(splitObservations),
  });
}
