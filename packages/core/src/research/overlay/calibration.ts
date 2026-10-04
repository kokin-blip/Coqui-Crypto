import type { SigmoidCalibration } from './types.js';
export function calibratedProbability(calibration: SigmoidCalibration, score: number): number {
  if (!Number.isFinite(score)) return NaN;
  const z = Math.max(-35, Math.min(35, calibration.intercept + calibration.slope * score)); return 1 / (1 + Math.exp(-z));
}
export function fitOverlayCalibration(scores: readonly number[], labels: readonly boolean[]): SigmoidCalibration | null {
  const positives = labels.filter(Boolean).length;
  if (scores.length < 60 || scores.length !== labels.length || positives < 10 || labels.length - positives < 10 || scores.some((v) => !Number.isFinite(v))) return null;
  let intercept = Math.log(positives / (labels.length - positives)), slope = 0;
  const loss = (a: number, b: number) => scores.reduce((sum, x, i) => {
    const p = calibratedProbability({ intercept: a, slope: b, observations: scores.length }, x);
    return sum - Math.log(labels[i] ? p : 1 - p);
  }, 0) + 0.0005 * b * b;
  for (let step = 0; step < 100; step++) {
    let ga = 0, gb = 0.001 * slope, haa = 0, hab = 0, hbb = 0.001;
    scores.forEach((x, i) => {
      const p = calibratedProbability({ intercept, slope, observations: scores.length }, x), error = p - Number(labels[i]), w = p * (1 - p);
      ga += error; gb += error * x; haa += w; hab += w * x; hbb += w * x * x;
    });
    if (Math.max(Math.abs(ga), Math.abs(gb)) < 1e-7) return { intercept, slope, observations: scores.length };
    const determinant = haa * hbb - hab * hab;
    if (!(determinant > 1e-12)) return null;
    const da = (hbb * ga - hab * gb) / determinant, db = (haa * gb - hab * ga) / determinant;
    let fraction = 1, accepted = false;
    for (let line = 0; line < 30; line++, fraction /= 2) if (loss(intercept - da * fraction, slope - db * fraction) <= loss(intercept, slope)) {
      intercept -= da * fraction; slope -= db * fraction; accepted = true; break;
    }
    if (!accepted) return null;
  }
  return null;
}
export function calibrationDiagnostics(probabilities: readonly number[], labels: readonly boolean[]) {
  if (probabilities.length !== labels.length || !labels.length || probabilities.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) return null;
  const clamp = (p: number) => Math.max(1e-12, Math.min(1 - 1e-12, p));
  const scores = probabilities.map((p) => Math.log(clamp(p) / (1 - clamp(p))));
  const fitted = fitOverlayCalibration(scores, labels);
  return { observations: labels.length,
    brier: probabilities.reduce((s, p, i) => s + (p - Number(labels[i])) ** 2, 0) / labels.length,
    logLoss: probabilities.reduce((s, p, i) => s - Math.log(clamp(labels[i] ? p : 1 - p)), 0) / labels.length,
    intercept: fitted?.intercept ?? null, slope: fitted?.slope ?? null,
    riskCoverage: [0, 0.55, 0.65, 0.75, 0.85, 0.95].map((threshold) => {
      const selected = probabilities.flatMap((p, i) => p >= threshold ? [i] : []);
      return { threshold, count: selected.length, coverage: selected.length / labels.length,
        negativeActionRate: selected.length ? selected.filter((i) => !labels[i]).length / selected.length : null };
    }),
    buckets: Array.from({ length: 10 }, (_, bucket) => {
      const indices = probabilities.flatMap((p, i) => Math.min(9, Math.floor(p * 10)) === bucket ? [i] : []);
      const successes = indices.reduce((s, i) => s + Number(labels[i]), 0), n = indices.length, p = n ? successes / n : 0, z2 = 1.96 ** 2;
      const center = n ? (p + z2 / (2 * n)) / (1 + z2 / n) : 0;
      const radius = n ? 1.96 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n) : 0;
      return { lower: bucket / 10, count: indices.length, wilson95: n ? [center - radius, center + radius] : null,
        observedFrequency: indices.length ? indices.reduce((s, i) => s + Number(labels[i]), 0) / indices.length : null };
    }) };
}
