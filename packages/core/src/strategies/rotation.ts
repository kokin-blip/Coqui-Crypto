/**
 * Cross-sectional momentum rotation — the "hunt strength" return engine
 * (vault note 28 next-candidates; both research reports list cross-sectional
 * momentum as a core evidenced crypto strategy). Pure (CLAUDE.md §2).
 *
 * Instead of reweighting a fixed base mix (the momentum track), rotation ranks
 * an entire UNIVERSE of coins by risk-adjusted momentum and holds only the
 * strongest few:
 *
 *  - eligibility: enough history for the lookback (young listings join later —
 *    no look-ahead, no survivorship fudge: they simply aren't tradeable yet);
 *  - absolute filter: assets with a negative lookback return are excluded, so
 *    an all-down tape rotates to cash instead of "the least-bad coin";
 *  - selection: top N by momentum ÷ realized vol;
 *  - weighting: equal or inverse-volatility across the selected basket.
 *
 * This module only produces targets. The shared backtest engine owns execution
 * timing and costs; the predecessor's same-bar rotation backtest is retired.
 */

import type { InstrumentKey } from '../types/index.js';

export interface RotationConfig {
  /** How many of the strongest assets to hold. */
  topN: number;
  /** Momentum lookback in daily closes (120 per the 2026-07-04 sweep). */
  lookbackDays: number;
  /** Window for realized volatility, in daily returns. */
  volatilityDays: number;
  /** Exclude assets whose lookback return is negative (defensive cash). */
  absoluteFilter: boolean;
  /** How to weight the selected basket. */
  weighting: 'equal' | 'inverse_vol';
  /**
   * Turnover hysteresis: a currently-held asset stays as long as it still ranks
   * within `topN × holdBufferMultiple` (and passes the absolute filter). 1 =
   * no buffer (churn on every rank change); 2–3 cuts fee bleed dramatically.
   */
  holdBufferMultiple: number;
}

export const DEFAULT_ROTATION_CONFIG: RotationConfig = {
  topN: 5,
  lookbackDays: 120,
  volatilityDays: 30,
  absoluteFilter: true,
  weighting: 'inverse_vol',
  holdBufferMultiple: 2,
};

export interface RotationPick {
  assetId: InstrumentKey;
  weight: number;
  returnPct: number;
  volatilityPct: number;
  riskAdjustedMomentum: number;
}

export interface RotationTargetsResult {
  picks: RotationPick[];
  cashWeight: number;
  /** Assets that had enough history to be considered. */
  eligible: number;
}

const YEAR = 365;

function statsFor(
  closes: number[],
  config: RotationConfig,
): { returnPct: number; volatilityPct: number } | null {
  const lookback = Math.max(1, Math.floor(config.lookbackDays));
  if (closes.length <= lookback) return null;
  const start = closes[closes.length - 1 - lookback]!;
  const end = closes[closes.length - 1]!;
  if (start <= 0 || end <= 0) return null;

  const rets: number[] = [];
  const from = Math.max(1, closes.length - Math.max(2, config.volatilityDays));
  for (let i = from; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev > 0 && cur > 0) rets.push(cur / prev - 1);
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return {
    returnPct: end / start - 1,
    volatilityPct: Math.sqrt(variance) * Math.sqrt(YEAR) * 100,
  };
}

/**
 * Rank the universe as of the LAST day of each series and build basket targets.
 * Weights sum to ≤ 1; the remainder (no eligible/positive assets) is cash.
 * `held` (current basket) enables the hold-buffer hysteresis: an incumbent
 * survives while it still ranks within `topN × holdBufferMultiple`.
 */
export function rotationTargets(
  closesById: Partial<Record<InstrumentKey, number[]>>,
  config: RotationConfig = DEFAULT_ROTATION_CONFIG,
  held: InstrumentKey[] = [],
): RotationTargetsResult {
  const scored: RotationPick[] = [];
  let eligible = 0;
  const entries = Object.entries(closesById) as [InstrumentKey, number[] | undefined][];
  for (const [assetId, closes] of entries) {
    if (!closes) continue;
    const s = statsFor(closes, config);
    if (!s) continue;
    eligible += 1;
    if (config.absoluteFilter && s.returnPct <= 0) continue;
    // Floor the vol at 5% annualized so a near-flat series can't post an
    // absurd risk-adjusted score off floating-point dust.
    const riskAdj = s.returnPct / (Math.max(s.volatilityPct, 5) / 100);
    scored.push({ assetId, weight: 0, ...s, riskAdjustedMomentum: riskAdj });
  }
  scored.sort((a, b) => b.riskAdjustedMomentum - a.riskAdjustedMomentum);

  const topN = Math.max(1, Math.floor(config.topN));
  const bufferRank = topN * Math.max(1, config.holdBufferMultiple);
  const heldSet = new Set(held);
  // Incumbents that still rank inside the buffer keep their seat…
  const keep = scored.filter((p, i) => heldSet.has(p.assetId) && i < bufferRank).slice(0, topN);
  const kept = new Set(keep.map((p) => p.assetId));
  // …and the strongest newcomers fill the remaining seats.
  const picks = [...keep, ...scored.filter((p) => !kept.has(p.assetId))].slice(0, topN);
  if (picks.length === 0) return { picks: [], cashWeight: 1, eligible };

  if (config.weighting === 'inverse_vol') {
    const inv = picks.map((p) => (p.volatilityPct > 0 ? 1 / p.volatilityPct : 0));
    const sum = inv.reduce((s, x) => s + x, 0);
    picks.forEach((p, i) => {
      p.weight = sum > 0 ? inv[i]! / sum : 1 / picks.length;
    });
  } else {
    for (const p of picks) p.weight = 1 / picks.length;
  }
  return { picks, cashWeight: 0, eligible };
}

