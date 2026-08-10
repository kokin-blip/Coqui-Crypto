/** Daily simple returns from oldest-first closes. */
export function dailyReturns(closes: readonly number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index++) {
    const previous = closes[index - 1]!;
    const current = closes[index]!;
    returns.push(
      previous > 0 && Number.isFinite(previous) && Number.isFinite(current)
        ? current / previous - 1
        : 0,
    );
  }
  return returns;
}

/** Align close series to a trustworthy common recent return window. */
export function alignReturns(
  closesByAsset: readonly (readonly number[])[],
  minObservations = 30,
): number[][] | null {
  const usable = closesByAsset.filter((closes) => closes.length >= minObservations + 1);
  if (usable.length < 2 || usable.length !== closesByAsset.length) return null;
  const length = Math.min(...closesByAsset.map((closes) => closes.length));
  const returns = closesByAsset.map((closes) =>
    dailyReturns(closes.slice(closes.length - length)),
  );
  return returns[0]!.length >= minObservations ? returns : null;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Sample covariance matrix for rows of aligned returns. */
export function covariance(returnsByAsset: readonly (readonly number[])[]): number[][] {
  const assetCount = returnsByAsset.length;
  const observationCount = returnsByAsset[0]!.length;
  const means = returnsByAsset.map(mean);
  const matrix = Array.from({ length: assetCount }, () =>
    new Array<number>(assetCount).fill(0),
  );
  const denominator = Math.max(observationCount - 1, 1);
  for (let left = 0; left < assetCount; left++) {
    for (let right = left; right < assetCount; right++) {
      let sum = 0;
      for (let time = 0; time < observationCount; time++) {
        sum +=
          (returnsByAsset[left]![time]! - means[left]!) *
          (returnsByAsset[right]![time]! - means[right]!);
      }
      const value = sum / denominator;
      matrix[left]![right] = value;
      matrix[right]![left] = value;
    }
  }
  return matrix;
}

/** Correlation matrix derived from a covariance matrix. */
export function correlation(covarianceMatrix: readonly (readonly number[])[]): number[][] {
  const standardDeviations = covarianceMatrix.map((row, index) =>
    Math.sqrt(Math.max(row[index]!, 0)),
  );
  return covarianceMatrix.map((row, left) =>
    row.map((value, right) => {
      const denominator = standardDeviations[left]! * standardDeviations[right]!;
      return denominator > 0
        ? Math.max(-1, Math.min(1, value / denominator))
        : left === right
          ? 1
          : 0;
    }),
  );
}

function normalize(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total > 0
    ? weights.map((weight) => weight / total)
    : weights.map(() => 1 / weights.length);
}

/** Inverse-volatility weights, where each weight is proportional to 1/sigma. */
export function inverseVolWeights(returnsByAsset: readonly (readonly number[])[]): number[] {
  const covarianceMatrix = covariance(returnsByAsset);
  const inverseVolatility = covarianceMatrix.map((row, index) => {
    const standardDeviation = Math.sqrt(Math.max(row[index]!, 0));
    return standardDeviation > 0 ? 1 / standardDeviation : 0;
  });
  return inverseVolatility.every((value) => value === 0)
    ? returnsByAsset.map(() => 1 / returnsByAsset.length)
    : normalize(inverseVolatility);
}

export type LinkRow = [number, number, number, number];

/** Deterministic single-linkage agglomerative clustering. */
export function singleLinkage(distances: readonly (readonly number[])[]): LinkRow[] {
  const assetCount = distances.length;
  const members = new Map<number, number[]>();
  for (let index = 0; index < assetCount; index++) members.set(index, [index]);
  const clusterDistance = (left: readonly number[], right: readonly number[]): number => {
    let minimum = Number.POSITIVE_INFINITY;
    for (const leftIndex of left) {
      for (const rightIndex of right) {
        minimum = Math.min(minimum, distances[leftIndex]![rightIndex]!);
      }
    }
    return minimum;
  };
  const linkage: LinkRow[] = [];
  let nextId = assetCount;
  while (members.size > 1) {
    const ids = [...members.keys()];
    let best = Number.POSITIVE_INFINITY;
    let bestLeft = ids[0]!;
    let bestRight = ids[1]!;
    for (let left = 0; left < ids.length; left++) {
      for (let right = left + 1; right < ids.length; right++) {
        const distance = clusterDistance(members.get(ids[left]!)!, members.get(ids[right]!)!);
        if (distance < best) {
          best = distance;
          bestLeft = ids[left]!;
          bestRight = ids[right]!;
        }
      }
    }
    const left = Math.min(bestLeft, bestRight);
    const right = Math.max(bestLeft, bestRight);
    const merged = [...members.get(left)!, ...members.get(right)!];
    linkage.push([left, right, best, merged.length]);
    members.delete(left);
    members.delete(right);
    members.set(nextId, merged);
    nextId += 1;
  }
  return linkage;
}

/** Recover quasi-diagonal leaf ordering from a linkage matrix. */
export function quasiDiag(linkage: readonly LinkRow[], assetCount: number): number[] {
  if (linkage.length === 0) return assetCount === 1 ? [0] : [];
  let order = [assetCount + linkage.length - 1];
  while (order.some((id) => id >= assetCount)) {
    const next: number[] = [];
    for (const id of order) {
      if (id < assetCount) next.push(id);
      else {
        const [left, right] = linkage[id - assetCount]!;
        next.push(left, right);
      }
    }
    order = next;
  }
  return order;
}

function inverseVarianceWeights(
  covarianceMatrix: readonly (readonly number[])[],
  indexes: readonly number[],
): number[] {
  const inverse = indexes.map((index) => {
    const variance = covarianceMatrix[index]![index]!;
    return variance > 0 ? 1 / variance : 0;
  });
  const total = inverse.reduce((sum, value) => sum + value, 0);
  return total > 0
    ? inverse.map((value) => value / total)
    : indexes.map(() => 1 / indexes.length);
}

function clusterVariance(
  covarianceMatrix: readonly (readonly number[])[],
  indexes: readonly number[],
): number {
  const weights = inverseVarianceWeights(covarianceMatrix, indexes);
  let variance = 0;
  for (let left = 0; left < indexes.length; left++) {
    for (let right = 0; right < indexes.length; right++) {
      variance +=
        weights[left]! *
        covarianceMatrix[indexes[left]!]![indexes[right]!]! *
        weights[right]!;
    }
  }
  return variance;
}

/** Hierarchical Risk Parity weights using recursive bisection. */
export function hrpWeights(returnsByAsset: readonly (readonly number[])[]): number[] {
  const assetCount = returnsByAsset.length;
  if (assetCount === 1) return [1];
  const covarianceMatrix = covariance(returnsByAsset);
  const correlations = correlation(covarianceMatrix);
  const distances = correlations.map((row) =>
    row.map((value) => Math.sqrt(Math.max(0, 0.5 * (1 - value)))),
  );
  const order = quasiDiag(singleLinkage(distances), assetCount);
  const weights = new Array<number>(assetCount).fill(0);
  for (const index of order) weights[index] = 1;
  let clusters: number[][] = [order];
  while (clusters.length > 0) {
    const next: number[][] = [];
    for (const cluster of clusters) {
      if (cluster.length <= 1) continue;
      const half = Math.floor(cluster.length / 2);
      const left = cluster.slice(0, half);
      const right = cluster.slice(half);
      const leftVariance = clusterVariance(covarianceMatrix, left);
      const rightVariance = clusterVariance(covarianceMatrix, right);
      const total = leftVariance + rightVariance;
      const alpha = total > 0 ? 1 - leftVariance / total : 0.5;
      for (const index of left) weights[index]! *= alpha;
      for (const index of right) weights[index]! *= 1 - alpha;
      next.push(left, right);
    }
    clusters = next;
  }
  return normalize(weights);
}

export type RiskBudgetMethod = 'inverse_vol' | 'hrp';

/** Return risk-budget weights in input order, or null when history is insufficient. */
export function riskBudgetWeights(
  closesByAsset: readonly (readonly number[])[],
  method: RiskBudgetMethod,
  minObservations = 30,
): number[] | null {
  if (closesByAsset.length < 2) return null;
  const returns = alignReturns(closesByAsset, minObservations);
  if (!returns) return null;
  const weights = method === 'hrp' ? hrpWeights(returns) : inverseVolWeights(returns);
  return weights.some((weight) => !Number.isFinite(weight)) ? null : weights;
}
