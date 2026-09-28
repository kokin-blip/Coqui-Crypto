/** Frozen first candidate: a small, deterministic four-hour paper signal. */
export const ML_SIGNAL_VERSION = 'trendvol-ml-ridge-v1';
export const ML_SIDE_COST = 0.005; // 0.25% taker fee + 0.10% spread + 0.15% slippage.
export const ML_MAX_DELTA = 0.10;
export const ML_FEATURE_COUNT = 5;

export interface MlSignalRow {
  readonly atMs: number;
  readonly features: readonly (readonly number[])[]; // BTC, ETH, LTC; five features each.
  readonly forwardReturns: readonly number[]; // next four hours, same asset order.
  readonly baseline: readonly number[];
}

export interface MlSignalModel {
  readonly version: typeof ML_SIGNAL_VERSION;
  readonly trainedThroughMs: number;
  readonly means: readonly (readonly number[])[];
  readonly scales: readonly (readonly number[])[];
  readonly coefficients: readonly (readonly number[])[];
}

function finite(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(rows[pivot]![column]!) < 1e-12) throw new Error('ml_singular_matrix');
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const divisor = rows[column]![column]!;
    for (let k = column; k <= n; k += 1) rows[column]![k] = rows[column]![k]! / divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = rows[row]![column]!;
      for (let k = column; k <= n; k += 1) rows[row]![k] = rows[row]![k]! - factor * rows[column]![k]!;
    }
  }
  return rows.map((row) => row[n]!);
}

export function trainMlSignal(rows: readonly MlSignalRow[]): MlSignalModel {
  if (rows.length < 400 || rows.some((row) => row.features.length !== 3 ||
    row.forwardReturns.length !== 3 || row.baseline.length !== 3 ||
    row.features.some((features) => features.length !== ML_FEATURE_COUNT || !finite(features)) ||
    !finite(row.forwardReturns) || !finite(row.baseline))) throw new Error('ml_training_data_incomplete');
  const means: number[][] = [], scales: number[][] = [], coefficients: number[][] = [];
  for (let asset = 0; asset < 3; asset += 1) {
    const samples = rows.map((row) => row.features[asset]!);
    const mean = Array.from({ length: ML_FEATURE_COUNT }, (_, feature) =>
      samples.reduce((sum, sample) => sum + sample[feature]!, 0) / samples.length);
    const scale = mean.map((value, feature) => Math.max(1e-8, Math.sqrt(samples.reduce((sum, sample) =>
      sum + (sample[feature]! - value) ** 2, 0) / samples.length)));
    const size = ML_FEATURE_COUNT + 1;
    const gram = Array.from({ length: size }, () => Array<number>(size).fill(0));
    const target = Array<number>(size).fill(0);
    rows.forEach((row, index) => {
      const x = [1, ...samples[index]!.map((value, feature) => (value - mean[feature]!) / scale[feature]!)];
      for (let i = 0; i < size; i += 1) {
        target[i] = target[i]! + x[i]! * row.forwardReturns[asset]!;
        for (let j = 0; j < size; j += 1) gram[i]![j] = gram[i]![j]! + x[i]! * x[j]!;
      }
    });
    // Fixed L2 strength; do not select it against the untouched holdout.
    for (let i = 1; i < size; i += 1) gram[i]![i] = gram[i]![i]! + 10;
    means.push(mean); scales.push(scale); coefficients.push(solve(gram, target));
  }
  return { version: ML_SIGNAL_VERSION, trainedThroughMs: rows.at(-1)!.atMs,
    means, scales, coefficients };
}

export function predictMlSignal(model: MlSignalModel, features: readonly (readonly number[])[]): readonly number[] {
  if (features.length !== 3 || features.some((row) => row.length !== ML_FEATURE_COUNT || !finite(row))) {
    throw new Error('ml_prediction_invalid');
  }
  const prediction = features.map((row, asset) => model.coefficients[asset]![0]! +
    row.reduce((sum, value, feature) => sum + model.coefficients[asset]![feature + 1]! *
      (value - model.means[asset]![feature]!) / model.scales[asset]![feature]!, 0));
  if (!finite(prediction)) throw new Error('ml_prediction_invalid');
  return prediction;
}

/** Enumerate bounded target changes; the host alone may turn one into orders. */
export function proposeMlTarget(baseline: readonly number[], prediction: readonly number[]) {
  if (baseline.length !== 3 || prediction.length !== 3 || !finite(baseline) || !finite(prediction) ||
    baseline.some((weight) => weight < 0) || baseline.reduce((a, b) => a + b, 0) > 1.0000001) {
    throw new Error('ml_target_invalid');
  }
  const exposure = baseline.reduce((a, b) => a + b, 0);
  let best = { weights: [...baseline], expectedNetImprovement: 0, turnover: 0 };
  const highest = prediction.indexOf(Math.max(...prediction));
  const lowest = prediction.indexOf(Math.min(...prediction));
  for (const exposureChange of [-ML_MAX_DELTA, 0, ML_MAX_DELTA]) {
    for (const tilt of [0, ML_MAX_DELTA]) {
      const nextExposure = Math.max(0, Math.min(1, exposure + exposureChange));
      const changed = exposure > 0 ? baseline.map((weight) => weight * nextExposure / exposure)
        : Array<number>(3).fill(nextExposure / 3);
      if (tilt > 0 && highest !== lowest) {
        const shifted = Math.min(tilt, changed[lowest]!);
        changed[lowest] = changed[lowest]! - shifted;
        changed[highest] = changed[highest]! + shifted;
      }
      if (changed.some((weight, asset) => weight < -1e-9 ||
        Math.abs(weight - baseline[asset]!) > ML_MAX_DELTA + 1e-9)) continue;
      const turnover = changed.reduce((sum, weight, asset) => sum + Math.abs(weight - baseline[asset]!), 0);
      // A new intraday position may need to be unwound; require both sides of friction.
      const benefit = changed.reduce((sum, weight, asset) =>
        sum + (weight - baseline[asset]!) * prediction[asset]!, 0) - turnover * ML_SIDE_COST * 2;
      if (benefit > best.expectedNetImprovement + 1e-12) {
        best = { weights: changed, expectedNetImprovement: benefit, turnover };
      }
    }
  }
  return best;
}
