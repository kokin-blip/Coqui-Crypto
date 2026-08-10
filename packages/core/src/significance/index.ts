/**
 * Statistical-significance controls for the strategy scoreboard — the discipline
 * both of Erick's research reports rank #1: when you race several strategies over a
 * short sample and pick the winner, its Sharpe is biased UP by the search itself.
 * These tools ask "is the leader a real edge, or the luckiest of N tries?"
 *
 *   - PROBABILISTIC SHARPE (PSR): probability the TRUE Sharpe exceeds a benchmark,
 *     given the observed Sharpe, sample length, skew, and kurtosis (Bailey & López
 *     de Prado 2012). Non-normal, small-sample honest.
 *   - DEFLATED SHARPE (DSR): PSR where the benchmark is the Sharpe you'd EXPECT as
 *     the maximum of N independent trials — i.e. it deflates for multiple testing.
 *     A leader only clears DSR if it beats what pure search luck would produce.
 *
 * All pure, deterministic, framework-agnostic (CLAUDE.md §2). Sharpe inputs here are
 * per-period (daily); callers annualize separately for display.
 */

const EULER_MASCHERONI = 0.5772156649015329;

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (ddof = 1 by default). */
export function stddev(xs: number[], ddof = 1): number {
  if (xs.length <= ddof) return 0;
  const m = mean(xs);
  const ss = xs.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - ddof));
}

/** Standardized skewness and kurtosis (population moments; normal kurtosis = 3). */
export function moments(xs: number[]): { skew: number; kurt: number } {
  const n = xs.length;
  if (n < 2) return { skew: 0, kurt: 3 };
  const m = mean(xs);
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  for (const x of xs) {
    const d = x - m;
    const d2 = d * d;
    s2 += d2;
    s3 += d2 * d;
    s4 += d2 * d2;
  }
  const variance = s2 / n;
  const sd = Math.sqrt(variance);
  const skew = sd > 0 ? s3 / n / sd ** 3 : 0;
  const kurt = variance > 0 ? s4 / n / (variance * variance) : 3;
  return { skew, kurt };
}

// --- Normal CDF / inverse (self-contained numerical approximations) -----------

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Standard normal CDF Φ(x). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Inverse standard normal CDF (Acklam's rational approximation), |error| < 1.15e-9. */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239e0,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0,
    4.374664141464968e0, 2.938163982698783e0,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

// --- PSR / DSR ----------------------------------------------------------------

/**
 * Probabilistic Sharpe Ratio: P(true Sharpe > `benchmark`) given an observed
 * per-period Sharpe over `n` returns with the given skew/kurtosis. Returns null when
 * the sample is too small to say anything.
 */
export function probabilisticSharpe(
  observedSharpe: number,
  n: number,
  skew: number,
  kurt: number,
  benchmark = 0,
): number | null {
  if (n < 2) return null;
  const varTerm = 1 - skew * observedSharpe + ((kurt - 1) / 4) * observedSharpe * observedSharpe;
  const denom = Math.sqrt(Math.max(varTerm, 1e-12));
  const z = ((observedSharpe - benchmark) * Math.sqrt(n - 1)) / denom;
  return normalCdf(z);
}

/**
 * Expected maximum per-period Sharpe under `nTrials` independent strategies whose
 * Sharpe estimates have standard deviation `sharpeStd` (Bailey & López de Prado).
 * This is the bar a leader must clear to be more than search luck.
 */
export function expectedMaxSharpe(sharpeStd: number, nTrials: number): number {
  if (nTrials <= 1 || sharpeStd <= 0) return 0;
  const a = normalInv(1 - 1 / nTrials);
  const b = normalInv(1 - 1 / (nTrials * Math.E));
  return sharpeStd * ((1 - EULER_MASCHERONI) * a + EULER_MASCHERONI * b);
}

/**
 * Deflated Sharpe Ratio: PSR of a candidate against the expected-maximum benchmark
 * implied by the whole field of `trialSharpes` (per-period Sharpes of every strategy
 * raced). Answers: does the leader beat what the search itself would produce?
 */
export function deflatedSharpe(
  candidateSharpe: number,
  n: number,
  skew: number,
  kurt: number,
  trialSharpes: number[],
): number | null {
  if (trialSharpes.length < 1 || n < 2) return null;
  const sharpeStd = trialSharpes.length > 1 ? stddev(trialSharpes, 1) : 0;
  const benchmark = expectedMaxSharpe(sharpeStd, trialSharpes.length);
  return probabilisticSharpe(candidateSharpe, n, skew, kurt, benchmark);
}

/**
 * Deflated Sharpe using an explicit registered search count. The observed field
 * supplies dispersion; `nTrials` supplies the search budget. No synthetic
 * zero-Sharpe observations are added to make those quantities agree.
 */
export function deflatedSharpeForTrials(
  candidateSharpe: number,
  n: number,
  skew: number,
  kurt: number,
  observedSharpes: number[],
  nTrials: number,
): number | null {
  const validSharpes = observedSharpes.filter(Number.isFinite);
  if (validSharpes.length < 1 || n < 2 || !Number.isSafeInteger(nTrials) || nTrials < 1) {
    return null;
  }
  const sharpeStd = validSharpes.length > 1 ? stddev(validSharpes, 1) : 0;
  const benchmark = expectedMaxSharpe(sharpeStd, nTrials);
  return probabilisticSharpe(candidateSharpe, n, skew, kurt, benchmark);
}

/** Per-period Sharpe (mean/σ) of a return series; null when σ is 0 or n < 2. */
export function periodSharpe(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const sd = stddev(returns, 1);
  return sd > 0 ? mean(returns) / sd : null;
}
