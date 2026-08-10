/**
 * Evidence tracker: the visible path to the LIVE gate. This is a measuring
 * stick, not an execution permission. Live execution remains hard-disabled.
 */

import type { StrategyBacktestResult } from '../backtest/index.js';

/** One day's honest read of the evidence, derived from the scoreboard. */
export interface EvidenceSnapshot {
  /** Day-start timestamp, ms (one row per day). */
  dayMs: number;
  /** Leading active strategy by per-day Sharpe. */
  leader: string;
  /** Deflated Sharpe: P(leader beats the field's search luck), 0-1. */
  dsr: number | null;
  /** Probabilistic Sharpe vs 0, 0-1. */
  psr: number | null;
  sigVerdict: 'significant' | 'inconclusive' | 'no_edge' | 'insufficient_data';
  wfVerdict: 'adds_value' | 'matches_passive' | 'lags_passive' | 'insufficient_data';
  leaderSortino: number | null;
  holdSortino: number | null;
  passiveSortino: number | null;
  /** Tradeable days the scoreboard judged. */
  sampleDays: number;
}

export interface EvidenceGateItem {
  id: 'significance' | 'walk_forward' | 'beats_benchmarks' | 'sample_size';
  label: string;
  met: boolean;
  /** Plain-English state, e.g. "DSR 92% - needs >=95%". */
  detail: string;
}

export interface EvidenceGateStatus {
  items: EvidenceGateItem[];
  /** True only when every item is met. */
  allMet: boolean;
  /** The honest headline for the card. */
  summary: string;
}

/** Sample floor for a meaningful out-of-sample window, in tradeable days. */
export const EVIDENCE_MIN_SAMPLE_DAYS = 365;

const ACTIVE_TRACKS = [
  'passive',
  'signal',
  'momentum',
  'voltarget',
  'trendvol',
  'rotation',
] as const;

function trackSortino(result: StrategyBacktestResult, name: string): number | null {
  if (ACTIVE_TRACKS.some((track) => track === name)) {
    return result[name as (typeof ACTIVE_TRACKS)[number]].metrics.sortino;
  }
  return null;
}

/** Map a scoreboard run to the day's evidence snapshot (pure). */
export function evidenceFromBacktest(
  result: StrategyBacktestResult,
  dayMs: number,
): EvidenceSnapshot {
  return {
    dayMs,
    leader: result.significance.leader,
    dsr: result.significance.dsr,
    psr: result.significance.psr,
    sigVerdict: result.significance.verdict,
    wfVerdict: result.walkForward.verdict,
    leaderSortino: trackSortino(result, result.significance.leader),
    holdSortino: result.hold.metrics.sortino,
    passiveSortino: result.passive.metrics.sortino,
    sampleDays: result.days,
  };
}

const pct = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`;
const f2 = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : value.toFixed(2);

/** Evaluate the LIVE-gate checklist for one snapshot (pure). */
export function evidenceGateChecklist(snapshot: EvidenceSnapshot): EvidenceGateStatus {
  const sigMet = snapshot.sigVerdict === 'significant';
  const wfMet = snapshot.wfVerdict === 'adds_value';
  const beatsHold =
    snapshot.leaderSortino !== null &&
    (snapshot.holdSortino === null || snapshot.leaderSortino > snapshot.holdSortino);
  const beatsPassive =
    snapshot.leaderSortino !== null &&
    (snapshot.passiveSortino === null || snapshot.leaderSortino > snapshot.passiveSortino);
  const benchMet = beatsHold && beatsPassive;
  const sampleMet = snapshot.sampleDays >= EVIDENCE_MIN_SAMPLE_DAYS;

  const items: EvidenceGateItem[] = [
    {
      id: 'significance',
      label: 'Lead survives the luck test (DSR >= 95%)',
      met: sigMet,
      detail: sigMet
        ? `DSR ${pct(snapshot.dsr)} - "${snapshot.leader}" is unlikely to be just the luckiest track raced.`
        : `DSR ${pct(snapshot.dsr)} (PSR ${pct(snapshot.psr)}) - needs >=95% before the lead counts as more than search luck.`,
    },
    {
      id: 'walk_forward',
      label: 'Adds value out-of-sample (walk-forward)',
      met: wfMet,
      detail: wfMet
        ? 'Picking the leader-so-far beat holding and passive across the held-out folds.'
        : 'Adaptive selection has not beaten the passive benchmarks out-of-sample yet.',
    },
    {
      id: 'beats_benchmarks',
      label: 'Leader beats buy-and-hold AND passive on Sortino',
      met: benchMet,
      detail: `${snapshot.leader} ${f2(snapshot.leaderSortino)} vs hold ${f2(snapshot.holdSortino)} / passive ${f2(snapshot.passiveSortino)}.`,
    },
    {
      id: 'sample_size',
      label: `Meaningful sample (>= ${EVIDENCE_MIN_SAMPLE_DAYS} tradeable days)`,
      met: sampleMet,
      detail: `${snapshot.sampleDays} days judged so far.`,
    },
  ];

  const metCount = items.filter((item) => item.met).length;
  const allMet = metCount === items.length;
  const summary = allMet
    ? 'The evidence bar is met - that still only earns a conversation. LIVE execution stays disabled and would be a separate, deliberate build.'
    : `${metCount} of ${items.length} evidence checks met. Every check must hold before live trading is even a conversation - and paper results never guarantee live ones.`;
  return { items, allMet, summary };
}
