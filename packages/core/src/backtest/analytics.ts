import {
  deflatedSharpeForTrials,
  moments,
  periodSharpe,
  probabilisticSharpe,
} from '../significance/index.js';
import { walkForwardSelection } from '../validation/index.js';
import type {
  EquityPoint,
  SignificanceReport,
  StrategyMetrics,
} from './types.js';

const YEAR = 365;

export function metricsFrom(equity: EquityPoint[]): StrategyMetrics {
  const zero: StrategyMetrics = {
    totalReturnPct: 0,
    annualizedReturnPct: 0,
    maxDrawdownPct: 0,
    volatilityPct: 0,
    sharpe: null,
    sortino: null,
    calmar: null,
  };
  if (equity.length < 2) return zero;
  const first = equity[0]!.value;
  const last = equity[equity.length - 1]!.value;
  if (first <= 0) return zero;

  const rets: number[] = [];
  let peak = first;
  let maxDd = 0;
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!.value;
    const cur = equity[i]!.value;
    if (prev > 0) rets.push(cur / prev - 1);
    if (cur > peak) peak = cur;
    if (peak > 0) maxDd = Math.min(maxDd, (cur - peak) / peak);
  }
  const nDays = equity.length - 1;
  const totalReturn = last / first - 1;
  const annReturn = Math.pow(last / first, YEAR / nDays) - 1;
  const mean = rets.reduce((sum, value) => sum + value, 0) / rets.length;
  const variance = rets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rets.length;
  const standardDeviation = Math.sqrt(variance);
  const volatility = standardDeviation * Math.sqrt(YEAR);
  const downside = rets.filter((value) => value < 0);
  const downsideDeviation =
    downside.length > 0
      ? Math.sqrt(downside.reduce((sum, value) => sum + value * value, 0) / downside.length) *
        Math.sqrt(YEAR)
      : 0;

  return {
    totalReturnPct: totalReturn * 100,
    annualizedReturnPct: annReturn * 100,
    maxDrawdownPct: maxDd * 100,
    volatilityPct: volatility * 100,
    sharpe: standardDeviation > 0 ? (mean / standardDeviation) * Math.sqrt(YEAR) : null,
    sortino: downsideDeviation > 0 ? (mean * YEAR) / downsideDeviation : null,
    calmar: maxDd < 0 ? annReturn / Math.abs(maxDd) : null,
  };
}

export function equityReturns(equity: EquityPoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const previous = equity[i - 1]!.value;
    if (previous > 0) returns.push(equity[i]!.value / previous - 1);
  }
  return returns;
}

export const NO_SIGNIFICANCE: SignificanceReport = {
  trials: 0,
  sampleDays: 0,
  leader: 'passive',
  leaderSharpe: null,
  psr: null,
  dsr: null,
  verdict: 'insufficient_data',
  note: 'Not enough history to test whether any strategy beats the field.',
};

export const NO_WALK_FORWARD = walkForwardSelection({}, { passive: [], hold: [] });

const MIN_SIGNIFICANCE_DAYS = 60;

export function computeSignificance(
  tracks: Record<string, EquityPoint[]>,
  registeredTrialCount?: number,
): SignificanceReport {
  if (registeredTrialCount === undefined || registeredTrialCount <= 0) {
    return {
      ...NO_SIGNIFICANCE,
      note: 'Significance is unavailable until the represented searches are recorded in TrialRegistry.',
    };
  }
  const entries = Object.entries(tracks).map(([name, equity]) => {
    const returns = equityReturns(equity);
    return { name, returns, sharpe: periodSharpe(returns) };
  });
  const rated = entries.filter(
    (entry): entry is typeof entry & { sharpe: number } => entry.sharpe !== null,
  );
  if (rated.length === 0) return { ...NO_SIGNIFICANCE, trials: entries.length };

  const trialCount = Math.max(entries.length, Math.floor(registeredTrialCount));
  const trialSharpes = rated.map((entry) => entry.sharpe);
  const leader = rated.reduce((best, entry) => (entry.sharpe > best.sharpe ? entry : best));
  const sampleDays = leader.returns.length;
  const leaderSharpe = leader.sharpe * Math.sqrt(YEAR);
  const { skew, kurt } = moments(leader.returns);
  const psr = probabilisticSharpe(leader.sharpe, sampleDays, skew, kurt, 0);
  const dsr = deflatedSharpeForTrials(
    leader.sharpe,
    sampleDays,
    skew,
    kurt,
    trialSharpes,
    trialCount,
  );
  const base = { trials: trialCount, sampleDays, leader: leader.name, leaderSharpe, psr, dsr };
  const percent = (value: number | null) =>
    value === null ? '—' : `${Math.round(value * 100)}%`;

  if (sampleDays < MIN_SIGNIFICANCE_DAYS) {
    return {
      ...base,
      verdict: 'insufficient_data',
      note: `Only ${sampleDays}d of history — too short for a trustworthy significance test (need ~${MIN_SIGNIFICANCE_DAYS}+).`,
    };
  }
  if (leader.sharpe <= 0) {
    return {
      ...base,
      verdict: 'no_edge',
      note: `No track has a positive Sharpe over this ${sampleDays}d window — nothing to call an edge yet.`,
    };
  }
  if (dsr !== null && dsr >= 0.95) {
    return {
      ...base,
      verdict: 'significant',
      note: `"${leader.name}" clears the deflated-Sharpe bar (DSR ${percent(dsr)}): unlikely to be just the luckiest of ${trialCount} registered trials over ${sampleDays}d.`,
    };
  }
  return {
    ...base,
    verdict: 'inconclusive',
    note: `"${leader.name}" leads but isn't yet distinguishable from ${trialCount}-trial search luck (DSR ${percent(dsr)}, need ≥95%). PSR vs 0 is ${percent(psr)}. More out-of-sample time needed.`,
  };
}
