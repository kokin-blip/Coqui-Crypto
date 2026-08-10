/**
 * Walk-forward selection test — the out-of-sample honesty check that pairs with the
 * Deflated Sharpe ({@link ./significance}). The scoreboard's whole premise is
 * "adaptively pick the best strategy". This asks the fair question: if, each period,
 * you had picked the strategy that was best SO FAR (using only prior data), would you
 * actually have beaten just holding — or staying passive — over the periods that
 * followed? In-sample a leader always exists; out-of-sample is what counts.
 *
 * Expanding-window design (look-ahead-free): split the tradeable window into folds;
 * for each fold after the first, select the leader by Sharpe over everything before
 * it, then bank THAT track's return during the fold. Stitch those out-of-sample folds
 * into one equity outcome and compare to always-hold, always-passive, and the
 * hindsight "oracle" upper bound. Pure/deterministic (CLAUDE.md §2).
 */

import { periodSharpe } from '../significance/index.js';

/** One out-of-sample fold: which track prior data picked, and how it actually did. */
export interface WalkForwardFold {
  /** 1-based index of the out-of-sample fold. */
  fold: number;
  /** Track chosen from data BEFORE this fold. */
  selected: string;
  /** The selected track's return over this fold, percent. */
  selectedReturnPct: number;
  /** The track that actually did best this fold (hindsight). */
  bestTrack: string;
  /** That hindsight-best return, percent. */
  bestReturnPct: number;
}

export type WalkForwardVerdict =
  | 'adds_value'
  | 'matches_passive'
  | 'lags_passive'
  | 'insufficient_data';

export interface WalkForwardResult {
  /** Folds the window was split into. */
  folds: number;
  /** Folds actually evaluated out-of-sample (folds − 1). */
  oosFolds: number;
  perFold: WalkForwardFold[];
  /** Out-of-sample return from picking the leader-so-far each fold, percent. */
  walkForwardReturnPct: number;
  /** Out-of-sample return of always staying passive, percent. */
  passiveReturnPct: number;
  /** Out-of-sample return of always holding, percent. */
  holdReturnPct: number;
  /** Hindsight upper bound: the best track each fold, percent. */
  oracleReturnPct: number;
  verdict: WalkForwardVerdict;
  note: string;
}

const EMPTY: WalkForwardResult = {
  folds: 0,
  oosFolds: 0,
  perFold: [],
  walkForwardReturnPct: 0,
  passiveReturnPct: 0,
  holdReturnPct: 0,
  oracleReturnPct: 0,
  verdict: 'insufficient_data',
  note: 'Not enough history to evaluate strategy selection out-of-sample.',
};

/** Compound a returns slice [from, to) into a single percent return. */
function compoundReturnPct(returns: number[], from: number, to: number): number {
  let v = 1;
  for (let i = from; i < to && i < returns.length; i++) v *= 1 + returns[i]!;
  return (v - 1) * 100;
}

/**
 * Walk-forward strategy-selection evaluation.
 *
 * @param activeReturns per-track daily returns for the SELECTABLE strategies.
 * @param benchmarks daily returns for the always-on baselines (passive, hold).
 * @param folds how many contiguous folds to split the window into.
 * @param minFoldDays minimum days per fold to attempt the test.
 */
export function walkForwardSelection(
  activeReturns: Record<string, number[]>,
  benchmarks: { passive: number[]; hold: number[] },
  folds = 4,
  minFoldDays = 20,
): WalkForwardResult {
  const names = Object.keys(activeReturns);
  if (names.length === 0) return EMPTY;
  const T = Math.min(...names.map((n) => activeReturns[n]!.length));
  if (folds < 2 || T < folds * minFoldDays) {
    return { ...EMPTY, folds: Math.max(0, folds), note: `Only ${T}d of returns — need ~${folds * minFoldDays}+ for a ${folds}-fold walk-forward.` };
  }

  const foldSize = Math.floor(T / folds);
  const perFold: WalkForwardFold[] = [];
  let wfEquity = 1;
  let oracleEquity = 1;

  for (let f = 1; f < folds; f++) {
    const inSampleEnd = f * foldSize;
    const oosStart = inSampleEnd;
    const oosEnd = f === folds - 1 ? T : (f + 1) * foldSize; // absorb remainder into the last fold

    // Select the leader by Sharpe over everything before this fold.
    let selected = names[0]!;
    let bestSharpe = -Infinity;
    for (const n of names) {
      const sr = periodSharpe(activeReturns[n]!.slice(0, inSampleEnd));
      if (sr !== null && sr > bestSharpe) {
        bestSharpe = sr;
        selected = n;
      }
    }

    // Score every track over the out-of-sample fold; bank the selected one.
    let bestTrack = names[0]!;
    let bestReturnPct = -Infinity;
    for (const n of names) {
      const r = compoundReturnPct(activeReturns[n]!, oosStart, oosEnd);
      if (r > bestReturnPct) {
        bestReturnPct = r;
        bestTrack = n;
      }
    }
    const selectedReturnPct = compoundReturnPct(activeReturns[selected]!, oosStart, oosEnd);

    wfEquity *= 1 + selectedReturnPct / 100;
    oracleEquity *= 1 + bestReturnPct / 100;
    perFold.push({ fold: f, selected, selectedReturnPct, bestTrack, bestReturnPct });
  }

  const oosStart = foldSize; // OOS spans folds 1..(folds-1) → returns index foldSize..T
  const passiveReturnPct = compoundReturnPct(benchmarks.passive, oosStart, T);
  const holdReturnPct = compoundReturnPct(benchmarks.hold, oosStart, T);
  const walkForwardReturnPct = (wfEquity - 1) * 100;
  const oracleReturnPct = (oracleEquity - 1) * 100;

  const baseline = Math.max(passiveReturnPct, holdReturnPct);
  const MARGIN = 0.5; // pp — avoid crowning noise
  let verdict: WalkForwardVerdict;
  if (walkForwardReturnPct > baseline + MARGIN) verdict = 'adds_value';
  else if (walkForwardReturnPct < baseline - MARGIN) verdict = 'lags_passive';
  else verdict = 'matches_passive';

  const fmt = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
  const oosFolds = folds - 1;
  const note =
    verdict === 'adds_value'
      ? `Out-of-sample, picking the leader each period returned ${fmt(walkForwardReturnPct)} — ahead of hold (${fmt(holdReturnPct)}) and passive (${fmt(passiveReturnPct)}). Adaptive selection added value across ${oosFolds} held-out folds.`
      : verdict === 'lags_passive'
        ? `Out-of-sample, chasing the leader returned ${fmt(walkForwardReturnPct)} — BEHIND just holding/passive (${fmt(baseline)}). Over ${oosFolds} held-out folds, switching strategies hurt; last period's winner didn't carry over.`
        : `Out-of-sample, picking the leader (${fmt(walkForwardReturnPct)}) roughly matched holding/passive (${fmt(baseline)}) across ${oosFolds} folds — no clear edge from switching yet.`;

  return {
    folds,
    oosFolds,
    perFold,
    walkForwardReturnPct,
    passiveReturnPct,
    holdReturnPct,
    oracleReturnPct,
    verdict,
    note,
  };
}
