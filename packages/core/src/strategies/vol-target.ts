import type { InstrumentKey } from '../types/index.js';

/**
 * Volatility-targeting overlay — the strongest-evidenced risk-adjusted lever for
 * crypto majors we didn't yet have (vault note 25). Pure (CLAUDE.md §2).
 *
 * It doesn't pick assets; it sizes total *exposure*. Given a mix's recent realized
 * portfolio volatility, scale how much of the book is invested so realized vol
 * tracks a target: hot tape → raise cash, calm tape → lean in (never leveraged
 * above 100%). An absolute **trend gate** (dual-momentum's defensive rule) caps
 * exposure further when the mix is below its own trend, truncating the left tail.
 *
 * Composable: it multiplies any base target set by a single `exposure` in [0,1];
 * the remainder is cash. Inputs are a value series, so it's trivially testable.
 */

const YEAR = 365;

export interface VolTargetConfig {
  /** Annualized target portfolio volatility, percent (crypto majors run hot). */
  targetVolPct: number;
  /** Lookback in daily returns for the realized-vol estimate. */
  volLookbackDays: number;
  /** Never fully out on vol alone — a floor so we don't whipsaw to zero. */
  minExposure: number;
  /** No leverage. */
  maxExposure: number;
  /** SMA length for the absolute trend gate. */
  trendGateDays: number;
  /** Exposure cap when the mix is below its trend (defensive). */
  belowTrendMaxExposure: number;
}

// Evidence-backed defaults (2026-07-04 sweeps, vault note 31): targetVolPct 40
// (was 50) ranked above 50/60 across cadences for the trendvol combo, and
// belowTrendMaxExposure 0.7 (was 0.5) — with momentum's own harsher defensive
// scaling, double-punishing below-trend tape cost return without cutting
// drawdown. Combined candidate: rolling mean Sortino 1.20→1.70, worst window
// DD −31%→−24%, full-window +71%→+101%.
export const DEFAULT_VOL_TARGET_CONFIG: VolTargetConfig = {
  targetVolPct: 40,
  volLookbackDays: 30,
  minExposure: 0.1,
  maxExposure: 1,
  trendGateDays: 100,
  belowTrendMaxExposure: 0.7,
};

export interface VolTargetResult {
  /** Base targets scaled by `exposure` (weights sum to `exposure`). */
  targets: { assetId: InstrumentKey; weight: number }[];
  /** Fraction invested, 0–1. */
  exposure: number;
  /** Uninvested fraction, `1 - exposure`. */
  cashWeight: number;
  /** Annualized realized vol of the mix over the lookback, percent; null if unknown. */
  realizedVolPct: number | null;
  /** Whether the mix sits below its trend gate. */
  belowTrend: boolean;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i]!;
  return s / period;
}

/** Annualized realized volatility (%) from the last `days` returns of a value series. */
export function realizedPortfolioVolPct(mixCloses: number[], days: number): number | null {
  const rets: number[] = [];
  for (let i = 1; i < mixCloses.length; i++) {
    const prev = mixCloses[i - 1]!;
    const cur = mixCloses[i]!;
    if (prev > 0 && cur > 0) rets.push(cur / prev - 1);
  }
  const window = rets.slice(-Math.max(2, days));
  if (window.length < 2) return null;
  const mean = window.reduce((s, r) => s + r, 0) / window.length;
  const variance = window.reduce((s, r) => s + (r - mean) ** 2, 0) / window.length;
  return Math.sqrt(variance) * Math.sqrt(YEAR) * 100;
}

/**
 * Compute the invested exposure for a mix from its value series. When realized vol
 * can't be estimated yet, default to fully invested (`maxExposure`) so early days
 * behave like passive rather than fabricating a defensive read.
 */
export function volTargetExposure(
  mixCloses: number[],
  config: VolTargetConfig = DEFAULT_VOL_TARGET_CONFIG,
): { exposure: number; realizedVolPct: number | null; belowTrend: boolean } {
  const realizedVolPct = realizedPortfolioVolPct(mixCloses, config.volLookbackDays);
  const trend = sma(mixCloses, config.trendGateDays);
  const last = mixCloses[mixCloses.length - 1] ?? 0;
  const belowTrend = trend !== null && last > 0 ? last < trend : false;

  let exposure =
    realizedVolPct !== null && realizedVolPct > 0
      ? clamp(config.targetVolPct / realizedVolPct, config.minExposure, config.maxExposure)
      : config.maxExposure;
  if (belowTrend) exposure = Math.min(exposure, config.belowTrendMaxExposure);
  return { exposure, realizedVolPct, belowTrend };
}

/**
 * Scale a base target set by the vol-target exposure. `mixCloses` is the value
 * series of the base mix (e.g. a normalized weighted index), most recent last.
 */
export function volTargetTargets(
  baseTargets: { assetId: InstrumentKey; weight: number }[],
  mixCloses: number[],
  config: VolTargetConfig = DEFAULT_VOL_TARGET_CONFIG,
): VolTargetResult {
  const clean = baseTargets
    .map((t) => ({ assetId: t.assetId, weight: Math.max(0, t.weight) }))
    .filter((t) => t.assetId && t.weight > 0);
  const sum = clean.reduce((s, t) => s + t.weight, 0);
  const { exposure, realizedVolPct, belowTrend } = volTargetExposure(mixCloses, config);
  if (sum <= 0) {
    return { targets: [], exposure, cashWeight: 1, realizedVolPct, belowTrend };
  }
  const targets = clean.map((t) => ({ assetId: t.assetId, weight: (t.weight / sum) * exposure }));
  return { targets, exposure, cashWeight: Math.max(0, 1 - exposure), realizedVolPct, belowTrend };
}
