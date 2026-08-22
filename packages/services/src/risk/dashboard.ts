import {
  resolveRiskControlState,
  type Clock,
  type RiskControlStage,
  type RiskControlState,
} from '@coqui/core';
import { listPortfolioSnapshots, type Db } from '@coqui/storage';

/**
 * The risk dashboard P8 owes.
 *
 * `resolveRiskControlState` has existed in `core` since the transplant and had
 * no reader outside the execution gate, so the ladder that decides whether the
 * engine may trade was invisible to the person it protects. This makes it
 * legible without making it adjustable — there is no setter here, and P8's exit
 * criterion is precisely that the gate cannot be edited from the UI.
 *
 * The stage is *derived*, every time, from the equity history. It is not stored
 * and cannot be overridden: a stage the user could set is a guardrail the user
 * could switch off, and `CLAUDE.md` §3.5 puts guardrails in code for exactly
 * that reason.
 */

export type RiskLadderStage = RiskControlStage;

export interface RiskLadderRung {
  readonly stage: RiskLadderStage;
  readonly active: boolean;
  /** What this rung does to position sizing, as a fraction of normal. */
  readonly exposureScale: number;
  readonly entryCondition: string;
}

export interface RiskDashboardView {
  readonly asOfMs: number;
  readonly stage: RiskLadderStage;
  readonly ladder: readonly RiskLadderRung[];
  readonly exposureScale: number;
  readonly drawdownPct: number;
  readonly expectedShortfallPct: number;
  readonly realizedVolatilityPct: number | null;
  readonly forecastVolatilityPct: number | null;
  readonly volatilityRatio: number | null;
  readonly maxGrossExposurePct: number;
  readonly maxTurnoverPct: number;
  readonly maxTradeCount: number;
  readonly staleMarketData: boolean;
  readonly blockReason: string | null;
  readonly warnings: readonly string[];
  /** How many equity observations the figures rest on. */
  readonly sampleCount: number;
  /** Age of the newest equity snapshot. Not the price-feed staleness above. */
  readonly snapshotAgeMs: number | null;
  /**
   * True when there is too little history for the derived figures to mean
   * anything. Drawdown over two points is arithmetic, not information.
   */
  readonly insufficientHistory: boolean;
}

export interface RiskDashboardDependencies {
  readonly database: Db;
  readonly clock: Clock;
}

/** Below this, a drawdown or volatility figure describes noise. */
const MIN_OBSERVATIONS = 20;

function ladderFor(state: RiskControlState): readonly RiskLadderRung[] {
  const { profile } = state;
  return Object.freeze([
    Object.freeze({
      stage: 'normal' as const,
      active: state.stage === 'normal',
      exposureScale: 1,
      entryCondition: 'Drawdown and volatility both inside the caution thresholds.',
    }),
    Object.freeze({
      stage: 'caution' as const,
      active: state.stage === 'caution',
      exposureScale: 0.5,
      entryCondition:
        `Drawdown at or beyond ${profile.cautionDrawdownPct}%, `
        + `or realised volatility ${profile.cautionVolatilityRatio}× the forecast.`,
    }),
    Object.freeze({
      stage: 'defense' as const,
      active: state.stage === 'defense',
      exposureScale: 0.25,
      entryCondition:
        `Drawdown at or beyond ${profile.defenseDrawdownPct}%, `
        + `or realised volatility ${profile.defenseVolatilityRatio}× the forecast.`,
    }),
    Object.freeze({
      stage: 'hard_stop' as const,
      active: state.stage === 'hard_stop',
      exposureScale: 0,
      entryCondition:
        `Drawdown at or beyond ${profile.hardStopDrawdownPct}%, or market data older than `
        + `${Math.round(profile.staleDataTimeoutMs / 60_000)} minutes. No trade is sized above zero.`,
    }),
  ]);
}

export class RiskDashboardService {
  readonly #database: Db;
  readonly #clock: Clock;

  constructor(dependencies: RiskDashboardDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
  }

  /**
   * Derive the current state. There is deliberately no counterpart that sets it.
   *
   * **No `marketDataAgeMs` is supplied**, and that is not an omission. The
   * staleness control measures the age of a *price feed*, whose default timeout
   * is two hours; portfolio snapshots are written on a daily cadence, so
   * passing snapshot age would report a permanent hard stop on a healthy
   * application. The execution gate reads it from the same place — which is to
   * say, nowhere yet — so the stage shown here is the stage the engine would
   * compute. A dashboard that disagreed with the gate would be worse than none.
   *
   * Snapshot age is still reported, as its own figure, labelled as what it is.
   */
  view(): RiskDashboardView {
    const asOfMs = this.#clock.nowMs();
    const snapshots = listPortfolioSnapshots(this.#database);
    const equityValues = snapshots
      .map((snapshot) => Number(snapshot.valueUsd))
      .filter((value) => Number.isFinite(value) && value > 0);

    const newest = snapshots.at(-1)?.at ?? null;
    const state = resolveRiskControlState({ equityValues });

    return Object.freeze({
      asOfMs,
      stage: state.stage,
      ladder: ladderFor(state),
      exposureScale: state.exposureScale,
      drawdownPct: state.drawdownPct,
      expectedShortfallPct: state.expectedShortfallPct,
      realizedVolatilityPct: state.realizedVolatilityPct,
      forecastVolatilityPct: state.forecastVolatilityPct,
      volatilityRatio: state.volatilityRatio,
      maxGrossExposurePct: state.maxGrossExposurePct,
      maxTurnoverPct: state.maxTurnoverPct,
      maxTradeCount: state.maxTradeCount,
      staleMarketData: state.staleMarketData,
      blockReason: state.blockReason,
      warnings: Object.freeze([...state.warnings]),
      sampleCount: equityValues.length,
      // How old the equity history itself is. Distinct from the feed staleness
      // above, which is about prices and is not observable from here.
      snapshotAgeMs: newest === null ? null : Math.max(0, asOfMs - newest),
      // Said outright rather than left for the reader to infer from a small
      // number: a drawdown computed over three points looks like a measurement.
      insufficientHistory: equityValues.length < MIN_OBSERVATIONS,
    });
  }
}
