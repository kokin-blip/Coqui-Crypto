import type { InstrumentKey } from '../types/index.js';

/**
 * Signal-tilted allocation — Phase A + C of the algorithm refinement (vault note
 * 17). Pure (CLAUDE.md §2). Turns the user's BASE target mix into a tactical tilt
 * driven by the long-term signals we already compute (Accumulate/Hold/Trim/Exit +
 * RSI + volatility regime): overweight conviction buys, underweight/raise-cash the
 * rest. The result is still just target weights — it feeds the same
 * `computeRebalancePlan` + paper simulation, behind the kill-switch, LIVE off.
 *
 * REGIME-ADAPTIVE (Phase C): a calm tape trend-follows (winners are trimmed more
 * gently — let them run); a volatile tape is faded harder but sized smaller (we
 * trust a whippy read less). Every knob is tunable ({@link TiltConfig}) so the
 * default can be effective while the user can still dial it.
 *
 * Confluence, not a single trigger: the tilt magnitude blends action + RSI stretch
 * + regime. Net-defensive signals let the targets sum below 1 (the gap is cash —
 * the release valve); net-bullish signals cap at fully invested (no leverage).
 */

/** The action half of a long-term read (mirrors market `LongTermAction`). */
export type TiltAction = 'accumulate' | 'hold' | 'trim' | 'exit';

/** One asset's signal inputs (mapped by the caller from a long-term read). */
export interface AssetSignal {
  assetId: InstrumentKey;
  action: TiltAction;
  /** RSI(14), 0–100, or null when unknown. */
  rsi: number | null;
  /** Volatility regime — a volatile tape gets a smaller, less-confident tilt. */
  regime: 'calm' | 'volatile';
}

/** Tunable tilt behavior. Defaults are the effective out-of-the-box strategy. */
export interface TiltConfig {
  /** Max fraction a base weight can be tilted up/down (default 0.6 = ±60%). */
  maxTilt: number;
  /** Baseline conviction magnitude for a trim/accumulate before RSI (default 0.3). */
  baseTilt: number;
  /** Extra conviction added by RSI extremity (default 0.5). */
  rsiScale: number;
  /** RSI points away from 50 that count as fully stretched (default 20). */
  rsiWindow: number;
  /** Conviction is multiplied by this in a VOLATILE regime — size down (default 0.6). */
  volatileDampen: number;
  /** Trim conviction ×this in a CALM regime — trend-follow, let winners run (default 0.7). */
  calmTrimRelief: number;
}

export const DEFAULT_TILT_CONFIG: TiltConfig = {
  maxTilt: 0.6,
  baseTilt: 0.3,
  rsiScale: 0.5,
  rsiWindow: 20,
  volatileDampen: 0.6,
  calmTrimRelief: 0.7,
};

/** Named presets by risk appetite (the Settings picker offers these). */
export const TILT_PRESETS: Record<'cautious' | 'balanced' | 'bold', TiltConfig> = {
  // Tilts hard to safety: bigger cash raises on Exit, trims winners sooner, small in vol.
  cautious: { maxTilt: 0.85, baseTilt: 0.4, rsiScale: 0.5, rsiWindow: 20, volatileDampen: 0.45, calmTrimRelief: 0.5 },
  balanced: { ...DEFAULT_TILT_CONFIG },
  // Stays close to the base mix: small tilts, rides the trend, trusts holdings.
  bold: { maxTilt: 0.4, baseTilt: 0.25, rsiScale: 0.45, rsiWindow: 20, volatileDampen: 0.8, calmTrimRelief: 0.9 },
};

/** Per-asset explanation of how its target was tilted. */
export interface TiltDetail {
  assetId: InstrumentKey;
  action: TiltAction;
  /** Tilt direction/strength in [-1, 1] (− underweight, + overweight). */
  conviction: number;
  baseWeight: number;
  tiltedWeight: number;
}

export interface TiltResult {
  /** The tilted targets (weights), to feed the rebalance planner. */
  targets: { assetId: InstrumentKey; weight: number }[];
  /** Uninvested share (0–1) the defensive tilt raised to cash. */
  cashWeight: number;
  details: TiltDetail[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Fill any missing config field from the defaults (tolerant of partial input). */
export function resolveTiltConfig(partial?: Partial<TiltConfig>): TiltConfig {
  return { ...DEFAULT_TILT_CONFIG, ...(partial ?? {}) };
}

/**
 * Conviction in [-1, 1] for one signal. Exit fully retreats; trim/accumulate
 * scale with how overbought/oversold RSI is; hold is neutral. Regime-adaptive:
 * calm eases trims (let winners run), volatile scales everything down.
 */
export function assetConviction(signal: AssetSignal, config: TiltConfig = DEFAULT_TILT_CONFIG): number {
  let c: number;
  switch (signal.action) {
    case 'exit':
      c = -1;
      break;
    case 'trim': {
      const hot = signal.rsi === null ? 0.4 : clamp((signal.rsi - 50) / config.rsiWindow, 0, 1);
      c = -(config.baseTilt + config.rsiScale * hot);
      if (signal.regime === 'calm') c *= config.calmTrimRelief; // trend-follow: trim gently
      break;
    }
    case 'accumulate': {
      const cold = signal.rsi === null ? 0.4 : clamp((50 - signal.rsi) / config.rsiWindow, 0, 1);
      c = config.baseTilt + config.rsiScale * cold;
      break;
    }
    default:
      c = 0; // hold
  }
  if (signal.regime === 'volatile') c *= config.volatileDampen; // size down in a whippy tape
  return clamp(c, -1, 1);
}

/**
 * Tilt the base targets by the signals. Assets without a signal keep their base
 * weight (neutral). Tilted weights that would sum above 1 are scaled back to 1
 * (no leverage); anything below 1 becomes {@link TiltResult.cashWeight}.
 */
export function tiltTargets(
  baseTargets: { assetId: InstrumentKey; weight: number }[],
  signals: AssetSignal[],
  config: TiltConfig = DEFAULT_TILT_CONFIG,
): TiltResult {
  const byId = new Map(signals.map((s) => [s.assetId, s]));
  const details: TiltDetail[] = [];

  let tilted = baseTargets.map((t) => {
    const sig = byId.get(t.assetId);
    const conviction = sig ? assetConviction(sig, config) : 0;
    const tiltedWeight = Math.max(0, t.weight * (1 + config.maxTilt * conviction));
    details.push({ assetId: t.assetId, action: sig?.action ?? 'hold', conviction, baseWeight: t.weight, tiltedWeight });
    return { assetId: t.assetId, weight: tiltedWeight };
  });

  const sum = tilted.reduce((s, t) => s + t.weight, 0);
  if (sum > 1 && sum > 0) {
    tilted = tilted.map((t) => ({ assetId: t.assetId, weight: t.weight / sum }));
    for (const d of details) d.tiltedWeight /= sum;
  }
  const finalSum = tilted.reduce((s, t) => s + t.weight, 0);

  return { targets: tilted, cashWeight: Math.max(0, 1 - finalSum), details };
}
