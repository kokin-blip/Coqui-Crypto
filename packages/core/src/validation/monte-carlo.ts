/**
 * Monte Carlo evidence machinery — "run simulations to gather more data",
 * done the statistically defensible way. Pure + deterministic (seeded RNG).
 *
 * Real history is one path; it can't be extended. What CAN be done honestly:
 *
 *  1. **Synthetic markets** — stationary block bootstrap (Politis–Romano) of
 *     the JOINT daily returns: resample whole time-blocks across all assets at
 *     once, so fat tails, volatility clustering, and cross-asset correlation
 *     survive, then compound them into synthetic close series. Running the
 *     frozen strategy over thousands of these alternate histories measures how
 *     often the edge shows up and how bad the tails get — information a single
 *     path cannot give.
 *
 *  2. **Bootstrap p-values on the real path** — the White's-Reality-Check-style
 *     question from the research reports: center the strategy-minus-benchmark
 *     daily excess series at zero (the no-edge null), resample it many times,
 *     and ask how often chance alone produces a mean as large as observed.
 *
 * Everything is seeded and pure so results are reproducible in tests and
 * research runs. Nothing here drives trading.
 */

/** Deterministic 32-bit PRNG (mulberry32) — good enough for bootstrap work. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Daily simple returns per asset, aligned to the shortest series tail. */
export function jointDailyReturns(closesById: Record<string, number[]>): {
  ids: string[];
  returns: number[][]; // [day][asset]
  firstCloses: number[];
} {
  const ids = Object.keys(closesById).filter((id) => (closesById[id]?.length ?? 0) > 1);
  if (ids.length === 0) return { ids: [], returns: [], firstCloses: [] };
  const L = Math.min(...ids.map((id) => closesById[id]!.length));
  const aligned = ids.map((id) => closesById[id]!.slice(-L));
  const returns: number[][] = [];
  for (let t = 1; t < L; t++) {
    const row = aligned.map((series) => {
      const prev = series[t - 1]!;
      const cur = series[t]!;
      return prev > 0 && cur > 0 ? cur / prev - 1 : 0;
    });
    returns.push(row);
  }
  return { ids, returns, firstCloses: aligned.map((s) => s[0]!) };
}

/**
 * Stationary block bootstrap over row indices: each step continues the current
 * block with probability (1 − 1/meanBlockLen) or jumps to a uniform random
 * start, wrapping circularly. Returns `n` sampled row indices.
 */
export function stationaryBootstrapIndices(
  sourceLength: number,
  n: number,
  meanBlockLen: number,
  rand: () => number,
): number[] {
  const out: number[] = [];
  if (sourceLength <= 0 || n <= 0) return out;
  const pNew = 1 / Math.max(1, meanBlockLen);
  let idx = Math.floor(rand() * sourceLength);
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      idx = rand() < pNew ? Math.floor(rand() * sourceLength) : (idx + 1) % sourceLength;
    }
    out.push(idx);
  }
  return out;
}

/**
 * One synthetic market: bootstrap the joint return rows and compound them into
 * synthetic close series (each asset restarts at its real first close). All
 * assets share the SAME sampled days, preserving cross-correlation.
 */
export function syntheticMarket(
  joint: { ids: string[]; returns: number[][]; firstCloses: number[] },
  days: number,
  meanBlockLen: number,
  rand: () => number,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const rows = stationaryBootstrapIndices(joint.returns.length, days, meanBlockLen, rand);
  joint.ids.forEach((id, a) => {
    const series: number[] = [joint.firstCloses[a]!];
    for (const r of rows) {
      const ret = joint.returns[r]![a]!;
      series.push(series[series.length - 1]! * (1 + ret));
    }
    out[id] = series;
  });
  return out;
}

export interface BootstrapPValueResult {
  /** Observed mean daily excess return (strategy − benchmark). */
  observedMeanExcess: number;
  /** One-sided p-value: P(mean this large | no edge), via null-centered resampling. */
  pValue: number;
  resamples: number;
}

/**
 * Bootstrap p-value for "strategy beats benchmark": null-center the daily
 * excess series (subtract its mean), resample with the stationary bootstrap,
 * and count how often chance produces a mean ≥ the observed one.
 */
export function bootstrapExcessPValue(
  strategyReturns: number[],
  benchmarkReturns: number[],
  opts: { resamples?: number; meanBlockLen?: number; seed?: number } = {},
): BootstrapPValueResult {
  const n = Math.min(strategyReturns.length, benchmarkReturns.length);
  const resamples = opts.resamples ?? 2000;
  const meanBlockLen = opts.meanBlockLen ?? 20;
  const rand = mulberry32(opts.seed ?? 42);
  if (n < 30) return { observedMeanExcess: 0, pValue: 1, resamples: 0 };

  const excess: number[] = [];
  for (let i = 0; i < n; i++) excess.push(strategyReturns[i]! - benchmarkReturns[i]!);
  const observed = excess.reduce((s, x) => s + x, 0) / n;
  const centered = excess.map((x) => x - observed); // null: true mean excess = 0

  let asExtreme = 0;
  for (let b = 0; b < resamples; b++) {
    const idx = stationaryBootstrapIndices(n, n, meanBlockLen, rand);
    let sum = 0;
    for (const i of idx) sum += centered[i]!;
    if (sum / n >= observed) asExtreme += 1;
  }
  return { observedMeanExcess: observed, pValue: asExtreme / resamples, resamples };
}
