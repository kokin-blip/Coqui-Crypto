import { Decimal } from 'decimal.js';

import { CAPITAL_RESTORATION, type CapitalMetric } from './capital-ledger.js';

export const CapitalDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export const CAPITAL_DAY_MS = 86_400_000;
export const CAPITAL_YEAR_MS = 365 * CAPITAL_DAY_MS;

export function capitalResult(value: Decimal.Value, method: string, evidenceRefs: readonly string[]): CapitalMetric {
  const parsed = new CapitalDecimal(value);
  if (!parsed.isFinite()) return capitalUnavailable('zero_denominator');
  const rounded = parsed.toDecimalPlaces(12);
  return { state: 'available', value: rounded.isZero() ? '0' : rounded.toFixed(), method, evidenceRefs };
}

export function capitalUnavailable(...reasons: readonly string[]): CapitalMetric {
  const reasonCodes = [...new Set(reasons)].sort();
  return { state: 'unavailable', reasonCodes, missingEvidence: reasonCodes,
    restoration: reasonCodes.map((reason) => CAPITAL_RESTORATION[reason] ??
      `Acquire authoritative evidence resolving ${reason.replaceAll('_', ' ')}; no value is inferred.`) };
}

export interface DatedCapitalCashFlow { readonly atMs: number; readonly amount: string }

/** One sign change certifies uniqueness for the ordered exponential cash-flow polynomial. */
export function certifiedCapitalIrr(flows: readonly DatedCapitalCashFlow[], refs: readonly string[]): CapitalMetric {
  const grouped = new Map<number, Decimal>();
  for (const flow of flows) grouped.set(flow.atMs, new CapitalDecimal(grouped.get(flow.atMs) ?? 0).add(flow.amount));
  const ordered = [...grouped].sort(([a], [b]) => a - b).filter(([, amount]) => !amount.isZero());
  if (ordered.length < 2) return capitalUnavailable('irr_no_solution');
  const signChanges = ordered.slice(1).filter(([, amount], i) => amount.isPositive() !== ordered[i]![1].isPositive()).length;
  if (signChanges === 0) return capitalUnavailable('irr_no_solution');
  if (signChanges !== 1) return capitalUnavailable('irr_uniqueness_unproven');
  const origin = ordered[0]![0];
  const years = ordered.map(([at]) => new CapitalDecimal(at - origin).div(CAPITAL_YEAR_MS));
  // Solve in log(1+r), avoiding a discontinuity at r=-1. Bounded numerical support is explicit.
  const npv = (logRate: Decimal): Decimal => ordered.reduce((sum, [, amount], i) =>
    sum.add(amount.mul(years[i]!.mul(logRate).neg().exp())), new CapitalDecimal(0));
  let low = new CapitalDecimal(-1), high = new CapitalDecimal(1);
  let left = npv(low), right = npv(high);
  for (let i = 0; i < 12 && left.isPositive() === right.isPositive(); i += 1) {
    low = low.mul(2); high = high.mul(2); left = npv(low); right = npv(high);
    if (!left.isFinite() || !right.isFinite()) return capitalUnavailable('irr_numerical_failure');
  }
  if (left.isZero()) return capitalResult(low.exp().sub(1).mul(100), 'certified-annual-irr-act365', refs);
  if (right.isZero()) return capitalResult(high.exp().sub(1).mul(100), 'certified-annual-irr-act365', refs);
  if (left.isPositive() === right.isPositive()) return capitalUnavailable('irr_numerical_failure');
  for (let i = 0; i < 220; i += 1) {
    const mid = low.add(high).div(2), value = npv(mid);
    if (!value.isFinite()) return capitalUnavailable('irr_numerical_failure');
    if (value.isZero() || high.sub(low).abs().lt('0.000000000000000000000001')) {
      return capitalResult(mid.exp().sub(1).mul(100), 'certified-annual-irr-act365', refs);
    }
    if (left.isPositive() === value.isPositive()) { low = mid; left = value; } else high = mid;
  }
  return capitalUnavailable('irr_numerical_failure');
}

export function capitalDailyStatistics(navs: readonly { atMs: number; nav: Decimal }[], refs: readonly string[]): {
  readonly maxDrawdownPct: CapitalMetric; readonly volatilityPct: CapitalMetric;
  readonly sharpe: CapitalMetric; readonly sortino: CapitalMetric; readonly timeBelowHighPct: CapitalMetric;
  readonly drawdowns: readonly string[];
} {
  const unavailable = capitalUnavailable('daily_series_incomplete');
  const missing = { maxDrawdownPct: unavailable, volatilityPct: unavailable, sharpe: unavailable,
    sortino: unavailable, timeBelowHighPct: unavailable, drawdowns: [] };
  if (navs.length < 2) return { ...missing, maxDrawdownPct: capitalUnavailable('insufficient_observations') };
  if (navs.some((point, i) => i > 0 && point.atMs - navs[i - 1]!.atMs !== CAPITAL_DAY_MS)) return missing;
  if (navs.some((point, i) => point.nav.lt(0) || i < navs.length - 1 && point.nav.isZero())) {
    return { ...missing, maxDrawdownPct: capitalUnavailable('zero_denominator') };
  }
  let peak = navs[0]!.nav, worst = new CapitalDecimal(0), below = 0;
  const drawdowns = navs.map(({ nav }) => {
    peak = CapitalDecimal.max(peak, nav);
    if (peak.isZero()) return '0';
    const dd = nav.div(peak).sub(1).mul(100);
    worst = CapitalDecimal.min(worst, dd); if (dd.lt(0)) below += 1;
    return dd.toDecimalPlaces(12).toFixed();
  });
  const returns = navs.slice(1).map(({ nav }, i) => nav.div(navs[i]!.nav).sub(1));
  const count = new CapitalDecimal(returns.length);
  const average = returns.reduce((sum, value) => sum.add(value), new CapitalDecimal(0)).div(count);
  const enough = returns.length >= 2;
  const volatility = enough ? returns.reduce((sum, value) => sum.add(value.sub(average).pow(2)),
    new CapitalDecimal(0)).div(count.sub(1)).sqrt() : null;
  const downside = returns.reduce((sum, value) => sum.add(CapitalDecimal.min(0, value).pow(2)),
    new CapitalDecimal(0)).div(count).sqrt();
  return {
    maxDrawdownPct: capitalResult(worst, 'daily-unit-nav-drawdown', refs),
    volatilityPct: volatility === null ? capitalUnavailable('insufficient_observations') :
      capitalResult(volatility.mul(new CapitalDecimal(365).sqrt()).mul(100), 'sample-daily-volatility-365', refs),
    sharpe: volatility === null ? capitalUnavailable('insufficient_observations') : volatility.isZero()
      ? capitalUnavailable('zero_denominator') : capitalResult(average.div(volatility).mul(new CapitalDecimal(365).sqrt()), 'daily-sharpe-rf0-365', refs),
    sortino: !enough ? capitalUnavailable('insufficient_observations') : downside.isZero() ? capitalUnavailable('zero_denominator') :
      capitalResult(average.div(downside).mul(new CapitalDecimal(365).sqrt()), 'daily-sortino-rf0-365', refs),
    timeBelowHighPct: capitalResult(new CapitalDecimal(below).div(navs.length).mul(100), 'observed-daily-time-below-high', refs),
    drawdowns,
  };
}
