import type { InstrumentKey } from '../types/index.js';

/**
 * Momentum/risk candidate engine — first slice of the "effective default"
 * research pass (vault note 18). Pure and offline: given daily closes + a base
 * allocation, produce candidate target weights using dual-momentum ideas:
 *
 * 1. Absolute momentum: assets with negative lookback return get scaled down.
 * 2. Relative momentum: stronger assets receive a modest overweight.
 * 3. Volatility adjustment: high-vol assets receive less weight.
 *
 * The result is just a target set for paper/backtests. No live execution.
 */

export interface MomentumConfig {
  /** Lookback used for absolute/relative momentum, in daily closes. */
  lookbackDays: number;
  /**
   * Optional multi-horizon trend ensemble (in daily closes). When set + non-empty,
   * the momentum return is the AVERAGE of the returns over each lookback (Faber/AQR
   * multi-timeframe trend — more robust than a single horizon). Unset ⇒ the single
   * `lookbackDays` path, byte-identical to before.
   */
  lookbackDaysEnsemble?: number[];
  /** Window used for realized volatility, in daily returns. */
  volatilityDays: number;
  /** Max fraction of an asset's base weight that can rotate toward/away from it. */
  maxRelativeTilt: number;
  /** Multiplier applied to negative-momentum assets before cash is raised. */
  defensiveScale: number;
  /** Annualized volatility target used to scale risky assets down. */
  targetVolatilityPct: number;
}

// Evidence-backed defaults (scripts/research-deep.mts, rolling 2y windows over
// ~5y of calendar-aligned Coinbase closes; vault notes 28 + 31):
//  - lookbackDays 120 (was 90): every lb120 config beat every lb90 config.
//  - defensiveScale 0.2 (was 0.35): cutting negative-momentum assets harder
//    ranked top of the 81-config defensive sweep on mean Sortino AND worst DD.
export const DEFAULT_MOMENTUM_CONFIG: MomentumConfig = {
  lookbackDays: 120,
  volatilityDays: 30,
  maxRelativeTilt: 0.35,
  defensiveScale: 0.2,
  targetVolatilityPct: 55,
};

export interface MomentumStat {
  assetId: InstrumentKey;
  /** Lookback return, e.g. 0.25 = +25%. */
  returnPct: number;
  /** Annualized realized volatility, percent. */
  volatilityPct: number;
  /** Return divided by volatility; used for relative ranking. */
  riskAdjustedMomentum: number;
}

export interface MomentumTargetResult {
  targets: { assetId: InstrumentKey; weight: number }[];
  cashWeight: number;
  stats: MomentumStat[];
}

const YEAR = 365;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeBase(
  baseTargets: { assetId: InstrumentKey; weight: number }[],
): { assetId: InstrumentKey; weight: number }[] {
  const clean = baseTargets
    .map((t) => ({ assetId: t.assetId, weight: Math.max(0, t.weight) }))
    .filter((t) => t.assetId && t.weight > 0);
  const sum = clean.reduce((s, t) => s + t.weight, 0);
  if (sum <= 0) return [];
  return clean.map((t) => ({ assetId: t.assetId, weight: t.weight / sum }));
}

function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev > 0 && cur > 0) out.push(cur / prev - 1);
  }
  return out;
}

function annualizedVolatilityPct(closes: number[], days: number): number {
  const rets = dailyReturns(closes).slice(-Math.max(2, days));
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(YEAR) * 100;
}

function annualizedVolatilityPctAt(
  closes: readonly number[],
  endExclusive: number,
  days: number,
): number {
  const wanted = Math.max(2, days);
  const reversed: number[] = [];
  for (let index = Math.min(endExclusive, closes.length) - 1; index >= 1; index -= 1) {
    const previous = closes[index - 1]!;
    const current = closes[index]!;
    if (previous > 0 && current > 0) reversed.push(current / previous - 1);
    if (reversed.length === wanted) break;
  }
  const rets = reversed.reverse();
  if (rets.length < 2) return 0;
  const mean = rets.reduce((sum, value) => sum + value, 0) / rets.length;
  const variance = rets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(YEAR) * 100;
}

/** Trend return over a single lookback, or null when history is insufficient. */
function lookbackReturn(closes: number[], lookbackDays: number): number | null {
  const lookback = Math.max(1, Math.floor(lookbackDays));
  if (closes.length <= lookback) return null;
  const start = closes[closes.length - 1 - lookback]!;
  const end = closes[closes.length - 1]!;
  if (start <= 0 || end <= 0) return null;
  return end / start - 1;
}

/** Compute one asset's momentum stat, or null when history is insufficient. */
export function momentumStat(
  assetId: InstrumentKey,
  closes: number[],
  config: MomentumConfig = DEFAULT_MOMENTUM_CONFIG,
): MomentumStat | null {
  // Trend signal = a single lookback return, or the average across an ensemble of
  // lookbacks (using only those the history can cover). Need at least one.
  const lookbacks =
    config.lookbackDaysEnsemble && config.lookbackDaysEnsemble.length > 0
      ? config.lookbackDaysEnsemble
      : [config.lookbackDays];
  const rets = lookbacks
    .map((lb) => lookbackReturn(closes, lb))
    .filter((r): r is number => r !== null);
  if (rets.length === 0) return null;
  const returnPct = rets.reduce((s, r) => s + r, 0) / rets.length;
  const volatilityPct = annualizedVolatilityPct(closes, config.volatilityDays);
  const riskAdjustedMomentum = volatilityPct > 0 ? returnPct / (volatilityPct / 100) : returnPct;
  return { assetId, returnPct, volatilityPct, riskAdjustedMomentum };
}

function momentumStatAt(
  assetId: InstrumentKey,
  closes: readonly number[],
  endExclusive: number,
  config: MomentumConfig,
): MomentumStat | null {
  const end = Math.min(Math.max(0, endExclusive), closes.length);
  const lookbacks = config.lookbackDaysEnsemble && config.lookbackDaysEnsemble.length > 0
    ? config.lookbackDaysEnsemble
    : [config.lookbackDays];
  const returns: number[] = [];
  for (const rawLookback of lookbacks) {
    const lookback = Math.max(1, Math.floor(rawLookback));
    if (end <= lookback) continue;
    const start = closes[end - 1 - lookback]!;
    const finish = closes[end - 1]!;
    if (start > 0 && finish > 0) returns.push(finish / start - 1);
  }
  if (returns.length === 0) return null;
  const returnPct = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const volatilityPct = annualizedVolatilityPctAt(closes, end, config.volatilityDays);
  return {
    assetId,
    returnPct,
    volatilityPct,
    riskAdjustedMomentum: volatilityPct > 0 ? returnPct / (volatilityPct / 100) : returnPct,
  };
}

function targetsFromStats(
  base: { assetId: InstrumentKey; weight: number }[],
  stats: MomentumStat[],
  config: MomentumConfig,
): MomentumTargetResult {
  const byId = new Map(stats.map((stat) => [stat.assetId, stat]));
  if (base.length === 0 || stats.length === 0) return { targets: [], cashWeight: 1, stats };
  const scores = stats.map((stat) => stat.riskAdjustedMomentum);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const spread = max - min;
  let targets = base.map((target) => {
    const stat = byId.get(target.assetId);
    if (!stat) return { assetId: target.assetId, weight: 0 };
    const relative = spread > 0 ? (stat.riskAdjustedMomentum - min) / spread : 0.5;
    const relativeTilt = 1 + config.maxRelativeTilt * (relative * 2 - 1);
    const defensive = stat.returnPct < 0 ? clamp(config.defensiveScale, 0, 1) : 1;
    const volScale = stat.volatilityPct > 0
      ? clamp(config.targetVolatilityPct / stat.volatilityPct, 0.15, 1)
      : 1;
    return { assetId: target.assetId, weight: target.weight * relativeTilt * defensive * volScale };
  });
  const sum = targets.reduce((total, target) => total + target.weight, 0);
  if (sum > 1) targets = targets.map((target) => ({ ...target, weight: target.weight / sum }));
  const finalSum = targets.reduce((total, target) => total + target.weight, 0);
  return { targets, cashWeight: Math.max(0, 1 - finalSum), stats };
}

/** @internal Indexed research path; avoids allocating every historical prefix. */
export function momentumTargetsAt(
  baseTargets: { assetId: InstrumentKey; weight: number }[],
  closesById: ReadonlyMap<InstrumentKey, readonly number[]>,
  endExclusive: number,
  config: MomentumConfig = DEFAULT_MOMENTUM_CONFIG,
): MomentumTargetResult {
  const base = normalizeBase(baseTargets);
  const stats = base
    .map((target) => momentumStatAt(
      target.assetId,
      closesById.get(target.assetId) ?? [],
      endExclusive,
      config,
    ))
    .filter((stat): stat is MomentumStat => stat !== null);
  return targetsFromStats(base, stats, config);
}

/**
 * Build candidate targets from base weights + close history. Weights may sum below
 * 1 when absolute momentum is negative or vol is above target; that remainder is
 * cash. Positive relative momentum rotates within the invested sleeve, never adds
 * leverage above 100%.
 */
export function momentumTargets(
  baseTargets: { assetId: InstrumentKey; weight: number }[],
  closesById: Partial<Record<InstrumentKey, number[]>>,
  config: MomentumConfig = DEFAULT_MOMENTUM_CONFIG,
): MomentumTargetResult {
  const base = normalizeBase(baseTargets);
  const stats = base
    .map((t) => momentumStat(t.assetId, closesById[t.assetId] ?? [], config))
    .filter((s): s is MomentumStat => s !== null);
  return targetsFromStats(base, stats, config);
}
