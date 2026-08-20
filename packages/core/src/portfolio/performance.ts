import { Decimal } from 'decimal.js';
import { decimal, type DecimalString, type UsdAmount } from '../types/index.js';
import {
  portfolioUtcDayKey,
  type PortfolioEvidenceSnapshot,
} from './snapshot-evidence.js';

/** One observed portfolio point; history is never fabricated retroactively. */
export interface PortfolioSnapshot {
  at: number;
  valueUsd: UsdAmount;
  costUsd: UsdAmount;
  realizedPnlUsd: DecimalString;
}

export interface PerformanceSummary {
  series: PortfolioSnapshot[];
  since: number | null;
  latestValueUsd: UsdAmount | null;
  periodChangeUsd: DecimalString;
  periodChangePct: number | null;
  netFlowUsd: DecimalString;
  growthUsd: DecimalString;
  totalPnlUsd: DecimalString | null;
  maxDrawdownPct: number;
  bestDayPct: number;
  worstDayPct: number;
  timeWeightedReturnPct: number | null;
}

/** Normalize a moment to UTC day start. */
export function dayKey(at: number): number {
  return portfolioUtcDayKey(at);
}

export interface VerifiedPortfolioPerformance {
  /** Latest deterministic observation for each requested UTC day. */
  readonly dailyEvidence: readonly PortfolioEvidenceSnapshot[];
  /** Complete days used by the performance calculation. */
  readonly verifiedEvidence: readonly PortfolioEvidenceSnapshot[];
  readonly excludedDayKeys: readonly number[];
  readonly performance: PerformanceSummary;
}

/**
 * Select one latest observation per UTC day and exclude incomplete or legacy
 * valuations from every return calculation. Historical evidence remains intact.
 */
export function summarizePortfolioEvidence(
  snapshots: readonly PortfolioEvidenceSnapshot[],
): VerifiedPortfolioPerformance {
  const ordered = [...snapshots].sort((left, right) =>
    left.dayKeyMs - right.dayKeyMs ||
    left.observedAtMs - right.observedAtMs ||
    left.recordedAtMs - right.recordedAtMs ||
    left.id.localeCompare(right.id),
  );
  const byDay = new Map<number, PortfolioEvidenceSnapshot>();
  for (const snapshot of ordered) byDay.set(snapshot.dayKeyMs, snapshot);
  const dailyEvidence = Object.freeze([...byDay.values()]);
  const verifiedEvidence = Object.freeze(dailyEvidence.filter(
    (snapshot) => snapshot.valuationStatus === 'complete' && snapshot.equityUsd !== null,
  ));
  const excludedDayKeys = Object.freeze(dailyEvidence
    .filter((snapshot) => snapshot.valuationStatus !== 'complete' || snapshot.equityUsd === null)
    .map((snapshot) => snapshot.dayKeyMs));
  const performance = summarizePerformance(verifiedEvidence.map((snapshot) => ({
    at: snapshot.dayKeyMs,
    valueUsd: snapshot.equityUsd!,
    costUsd: snapshot.openCostUsd,
    realizedPnlUsd: snapshot.realizedPnlUsd,
  })));
  return Object.freeze({ dailyEvidence, verifiedEvidence, excludedDayKeys, performance });
}

const EMPTY: PerformanceSummary = {
  series: [],
  since: null,
  latestValueUsd: null,
  periodChangeUsd: decimal('0'),
  periodChangePct: null,
  netFlowUsd: decimal('0'),
  growthUsd: decimal('0'),
  totalPnlUsd: null,
  maxDrawdownPct: 0,
  bestDayPct: 0,
  worstDayPct: 0,
  timeWeightedReturnPct: null,
};

/** Summarize observed snapshots without treating contributions as market return. */
export function summarizePerformance(
  snapshots: readonly PortfolioSnapshot[],
): PerformanceSummary {
  if (snapshots.length === 0) return { ...EMPTY, series: [] };
  const series = [...snapshots].sort((left, right) => left.at - right.at);
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const firstValue = new Decimal(first.valueUsd);
  const lastValue = new Decimal(last.valueUsd);
  const periodChange = lastValue.sub(firstValue);
  const netFlow = new Decimal(last.costUsd).sub(first.costUsd);
  const totalPnl = lastValue.sub(last.costUsd).add(last.realizedPnlUsd);

  let peak = firstValue;
  let maxDrawdownPct = 0;
  let bestDayPct = 0;
  let worstDayPct = 0;
  let timeWeightedFactor = new Decimal(1);
  let hasTimeWeightedReturn = false;
  for (let index = 1; index < series.length; index++) {
    const previous = series[index - 1]!;
    const current = series[index]!;
    const previousValue = new Decimal(previous.valueUsd);
    const currentValue = new Decimal(current.valueUsd);
    if (currentValue.gt(peak)) peak = currentValue;
    if (peak.gt(0)) {
      const drawdown = currentValue.sub(peak).div(peak).mul(100).toNumber();
      if (drawdown < maxDrawdownPct) maxDrawdownPct = drawdown;
    }
    if (previousValue.gt(0)) {
      const stepPct = currentValue.sub(previousValue).div(previousValue).mul(100).toNumber();
      if (stepPct > bestDayPct) bestDayPct = stepPct;
      if (stepPct < worstDayPct) worstDayPct = stepPct;
      const flow = new Decimal(current.costUsd).sub(previous.costUsd);
      timeWeightedFactor = timeWeightedFactor.mul(currentValue.sub(flow).div(previousValue));
      hasTimeWeightedReturn = true;
    }
  }

  return {
    series,
    since: first.at,
    latestValueUsd: last.valueUsd,
    periodChangeUsd: decimal(periodChange.toFixed()),
    periodChangePct: firstValue.gt(0) ? periodChange.div(firstValue).mul(100).toNumber() : null,
    netFlowUsd: decimal(netFlow.toFixed()),
    growthUsd: decimal(periodChange.sub(netFlow).toFixed()),
    totalPnlUsd: decimal(totalPnl.toFixed()),
    maxDrawdownPct,
    bestDayPct,
    worstDayPct,
    timeWeightedReturnPct: hasTimeWeightedReturn
      ? timeWeightedFactor.sub(1).mul(100).toNumber()
      : null,
  };
}
