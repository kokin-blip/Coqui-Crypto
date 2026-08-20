/**
 * Strategy backtest — Phase B of the algorithm refinement (vault note 17). Pure
 * (CLAUDE.md §2). Replays four portfolio strategies over the SAME real daily
 * closes so they're directly comparable, look-ahead-free, and reports risk-
 * adjusted metrics (Sortino/Calmar/max-drawdown) — the honest scoreboard for
 * "does the signal tilt actually beat passive + buy-and-hold?".
 *
 *  - hold     : buy the base mix once, never touch it (the do-nothing benchmark).
 *  - passive  : rebalance back to the base mix every N days (constant-mix).
 *  - signal   : every N days, re-read each asset from the data UP TO that day,
 *               tilt the base targets ({@link tiltTargets}), rebalance to that —
 *               raising cash when the reads turn defensive.
 *  - momentum : every N days, rebuild targets from absolute momentum, relative
 *               risk-adjusted momentum, and volatility scaling.
 *  - voltarget: every N days, scale the base mix's total exposure to hit a target
 *               portfolio volatility (raise cash when hot), with an absolute trend
 *               gate — the strongest-evidenced risk-adjusted lever (vault note 25).
 *  - trendvol : momentum's weights scaled by voltarget's exposure — the research-
 *               backed pairing: trend/momentum picks WHAT to hold, vol targeting
 *               sizes HOW MUCH is invested (both deep-research reports converge
 *               on this combo as the solo-builder default).
 *
 * The per-asset read is INJECTED (`evalSignal`) so this engine never imports the
 * market module — it stays trivially testable with a stub.
 */

import {
  rotationTargets,
  tiltTargets,
  DEFAULT_TILT_CONFIG,
  type AssetSignal,
} from '../strategies/index.js';
import { momentumTargetsAt } from '../strategies/momentum.js';
import { volTargetExposureAt } from '../strategies/vol-target.js';
import {
  DEFAULT_TRADE_COST_CONFIG,
  estimateTradeCost,
  type TradeCostConfig,
} from '../costs/index.js';
import { walkForwardSelection } from '../validation/index.js';
import type { DecisionMarketDataset } from '../market/index.js';
import type { InstrumentKey } from '../types/index.js';
import { trialCountForSignificance } from '../trials/index.js';
import {
  computeSignificance,
  equityReturns,
  metricsFrom,
  NO_SIGNIFICANCE,
  NO_WALK_FORWARD,
} from './analytics.js';
import type {
  DecisionStrategyBacktestResult,
  EquityPoint,
  StrategyBacktestOptions,
  StrategyBacktestResult,
  StrategyCostSummary,
  TrackResult,
} from './types.js';

const YEAR = 365;
const START_VALUE = 10_000;

const EMPTY_COSTS: StrategyCostSummary = {
  turnoverUsd: 0,
  totalCostUsd: 0,
  costPctOfStart: 0,
  events: 0,
};

/** @internal Shared with the bounded trend-vol research evaluator. */
export function normalizeBacktestWeights(
  targets: { assetId: InstrumentKey; weight: number }[],
): Map<InstrumentKey, number> {
  const sum = targets.reduce((s, t) => s + Math.max(0, t.weight), 0);
  const m = new Map<InstrumentKey, number>();
  if (sum <= 0) return m;
  for (const t of targets) if (t.weight > 0) m.set(t.assetId, t.weight / sum);
  return m;
}

/** Value a {cash, units} book at day `i`. */
/** @internal Shared with the bounded trend-vol research evaluator. */
export function backtestBookValue(
  cash: number,
  units: Map<InstrumentKey, number>,
  prices: Map<InstrumentKey, number>,
): number {
  let v = cash;
  for (const [id, u] of units) v += u * (prices.get(id) ?? 0);
  return v;
}

/** Rebalance the book to `weights` (summing ≤ 1; remainder → cash), charging commission. */
/** @internal Shared with the bounded trend-vol research evaluator. */
export function rebalanceBacktestBook(
  cash: number,
  units: Map<InstrumentKey, number>,
  prices: Map<InstrumentKey, number>,
  weights: Map<InstrumentKey, number>,
  tradeCosts: TradeCostConfig,
): { cash: number; units: Map<InstrumentKey, number>; turnoverUsd: number; costUsd: number } {
  const v = backtestBookValue(cash, units, prices);
  if (v <= 0) return { cash, units, turnoverUsd: 0, costUsd: 0 };
  let turnover = 0;
  let cost = 0;
  for (const [id, price] of prices) {
    const oldVal = (units.get(id) ?? 0) * price;
    const newVal = (weights.get(id) ?? 0) * v;
    const amountUsd = Math.abs(newVal - oldVal);
    turnover += amountUsd;
    if (amountUsd > 0) {
      cost += estimateTradeCost(
        {
          assetId: id,
          symbol: id,
          side: newVal >= oldVal ? 'buy' : 'sell',
          amountUsd,
        },
        tradeCosts,
      ).totalCostUsd;
    }
  }
  const vAfter = Math.max(0, v - cost);

  const newUnits = new Map<InstrumentKey, number>();
  for (const [id, price] of prices) {
    if (price > 0) newUnits.set(id, ((weights.get(id) ?? 0) * vAfter) / price);
  }
  const invested = [...weights.values()].reduce((s, w) => s + w, 0);
  return { cash: Math.max(0, (1 - invested) * vAfter), units: newUnits, turnoverUsd: turnover, costUsd: cost };
}

/** @internal Shared with the bounded trend-vol research evaluator. */
export function addBacktestCost(
  costs: StrategyCostSummary,
  event: { turnoverUsd: number; costUsd: number },
): StrategyCostSummary {
  const turnoverUsd = costs.turnoverUsd + event.turnoverUsd;
  const totalCostUsd = costs.totalCostUsd + event.costUsd;
  return {
    turnoverUsd,
    totalCostUsd,
    costPctOfStart: (totalCostUsd / START_VALUE) * 100,
    events: costs.events + (event.turnoverUsd > 0 ? 1 : 0),
  };
}

export function backtestStrategies(
  closesById: Partial<Record<InstrumentKey, number[]>>,
  baseTargets: { assetId: InstrumentKey; weight: number }[],
  opts: StrategyBacktestOptions,
): StrategyBacktestResult {
  const runAtMs = opts.clock.nowMs();
  const tradeCosts = opts.tradeCosts ?? DEFAULT_TRADE_COST_CONFIG;
  const tiltOpts = opts.tilt ?? DEFAULT_TILT_CONFIG;

  // Use only assets that have history AND a (positive) base weight.
  const baseWeights = normalizeBacktestWeights(baseTargets);
  const assets = [...baseWeights.keys()].filter((id) => (closesById[id]?.length ?? 0) > 0);
  const empty: TrackResult = { equity: [], metrics: metricsFrom([]), costs: EMPTY_COSTS };
  if (assets.length === 0) {
    return { runAtMs, hold: empty, passive: empty, signal: empty, momentum: empty, voltarget: empty, trendvol: empty, rotation: empty, significance: NO_SIGNIFICANCE, walkForward: NO_WALK_FORWARD, assets: [], days: 0, rebalanceEveryDays: opts.rebalanceEveryDays };
  }

  // Align to the shortest series (most recent L closes of each).
  const L = Math.min(...assets.map((id) => closesById[id]!.length));
  const series = new Map<InstrumentKey, number[]>(assets.map((id) => [id, closesById[id]!.slice(-L)]));
  const start = opts.warmup;
  if (L - start < 2) {
    return { runAtMs, hold: empty, passive: empty, signal: empty, momentum: empty, voltarget: empty, trendvol: empty, rotation: empty, significance: NO_SIGNIFICANCE, walkForward: NO_WALK_FORWARD, assets, days: Math.max(0, L - start), rebalanceEveryDays: opts.rebalanceEveryDays };
  }

  // Re-normalize base weights over the assets we kept.
  const keptBase = normalizeBacktestWeights(
    assets.map((id) => ({ assetId: id, weight: baseWeights.get(id) ?? 0 })),
  );
  const baseTargetList = assets.map((id) => ({ assetId: id, weight: keptBase.get(id) ?? 0 }));

  const closePricesAt = (i: number): Map<InstrumentKey, number> =>
    new Map(assets.map((id) => [id, series.get(id)![i]!]));
  const executionSeries = new Map<InstrumentKey, number[]>(
    assets.map((id) => {
      const supplied = opts.executionPricesById?.[id];
      return [id, supplied?.length === L ? supplied : series.get(id)!];
    }),
  );
  const executionPricesAt = (i: number): Map<InstrumentKey, number> =>
    new Map(assets.map((id) => [id, executionSeries.get(id)![i]!]));

  // Base-mix value index over the full window (starts at 1 on day 0) — the value
  // series the vol-target overlay reads for realized vol + its trend gate. Uses the
  // kept base weights so vol estimation is stable across rebalances.
  const mixIndex: number[] = [];
  for (let j = 0; j < L; j++) {
    let v = 0;
    for (const id of assets) {
      const p0 = series.get(id)![0]!;
      if (p0 > 0) v += (keptBase.get(id) ?? 0) * (series.get(id)![j]! / p0);
    }
    mixIndex.push(v);
  }

  // Initialize all four books fully allocated to the base mix at day `start`.
  const init = () => {
    const cash = START_VALUE;
    const r = rebalanceBacktestBook(cash, new Map(), executionPricesAt(start), keptBase, tradeCosts);
    return r;
  };
  const initialCosts = (r: { turnoverUsd: number; costUsd: number }): StrategyCostSummary => ({
    turnoverUsd: r.turnoverUsd,
    totalCostUsd: r.costUsd,
    costPctOfStart: (r.costUsd / START_VALUE) * 100,
    events: r.turnoverUsd > 0 ? 1 : 0,
  });
  const hold = init();
  let passive = init();
  let signal = init();
  let momentum = init();
  let voltarget = init();
  let trendvol = init();
  let rotation = init();
  const holdCosts = initialCosts(hold);
  let passiveCosts = initialCosts(passive);
  let signalCosts = initialCosts(signal);
  let momentumCosts = initialCosts(momentum);
  let voltargetCosts = initialCosts(voltarget);
  let trendvolCosts = initialCosts(trendvol);
  let rotationCosts = initialCosts(rotation);

  const holdEq: EquityPoint[] = [];
  const passiveEq: EquityPoint[] = [];
  const signalEq: EquityPoint[] = [];
  const momentumEq: EquityPoint[] = [];
  const voltargetEq: EquityPoint[] = [];
  const trendvolEq: EquityPoint[] = [];
  const rotationEq: EquityPoint[] = [];

  const cashGrowthDaily =
    opts.cashAprPct && opts.cashAprPct > 0 ? Math.pow(1 + opts.cashAprPct / 100, 1 / YEAR) : 1;

  for (let i = start; i < L; i++) {
    const tIdx = i - start;
    const prices = closePricesAt(i);
    const executionPrices = executionPricesAt(i);

    // Accrue yield on each book's cash sleeve (no-op at the default 0% APR).
    if (cashGrowthDaily !== 1 && tIdx > 0) {
      hold.cash *= cashGrowthDaily;
      passive.cash *= cashGrowthDaily;
      signal.cash *= cashGrowthDaily;
      momentum.cash *= cashGrowthDaily;
      voltarget.cash *= cashGrowthDaily;
      trendvol.cash *= cashGrowthDaily;
      rotation.cash *= cashGrowthDaily;
    }

    // Rebalance on cadence (not on the first day — already allocated).
    if (tIdx > 0 && tIdx % opts.rebalanceEveryDays === 0) {
      passive = rebalanceBacktestBook(passive.cash, passive.units, executionPrices, keptBase, tradeCosts);
      passiveCosts = addBacktestCost(passiveCosts, passive);

      // A decision made from completed bar D may execute no earlier than the
      // next eligible interval. The execution interval itself is never passed
      // to the signal evaluator.
      const signals: AssetSignal[] = [];
      for (const id of assets) {
        const read = opts.evalSignal(series.get(id)!.slice(0, i));
        if (read) signals.push({ assetId: id, action: read.action, rsi: read.rsi, regime: read.regime });
      }
      const tilted = tiltTargets(baseTargetList, signals, tiltOpts);
      const weights = new Map(tilted.targets.map((t) => [t.assetId, t.weight]));
      signal = rebalanceBacktestBook(signal.cash, signal.units, executionPrices, weights, tradeCosts);
      signalCosts = addBacktestCost(signalCosts, signal);

      // Momentum: rank/scale from data through the preceding completed bar. If no asset has enough
      // lookback yet, stay with the passive base mix rather than fabricating a
      // defensive read.
      const closesToDate: Partial<Record<InstrumentKey, number[]>> = {};
      for (const id of assets) closesToDate[id] = series.get(id)!.slice(0, i);
      const mom = momentumTargetsAt(baseTargetList, series, i, opts.momentum);
      const momentumWeights =
        mom.stats.length > 0 ? new Map(mom.targets.map((t) => [t.assetId, t.weight])) : keptBase;
      momentum = rebalanceBacktestBook(
        momentum.cash,
        momentum.units,
        executionPrices,
        momentumWeights,
        tradeCosts,
      );
      momentumCosts = addBacktestCost(momentumCosts, momentum);

      // Rotation shares this engine's next-interval fills. The retired standalone
      // backtest observed and filled the same bar, so none of its results migrate.
      const held = [...rotation.units.keys()].filter((id) => (rotation.units.get(id) ?? 0) > 0);
      const rotated = rotationTargets(closesToDate, opts.rotation, held);
      const rotationWeights = new Map(rotated.picks.map((pick) => [pick.assetId, pick.weight]));
      rotation = rebalanceBacktestBook(
        rotation.cash,
        rotation.units,
        executionPrices,
        rotationWeights,
        tradeCosts,
      );
      rotationCosts = addBacktestCost(rotationCosts, rotation);

      // Vol-target also observes only completed intervals before execution.
      const vt = volTargetExposureAt(mixIndex, i, opts.volTarget);
      // External exposure modifier (e.g. F&G overlay): scale the vol-target
      // exposure, never past fully invested.
      const scale = Math.max(0, opts.exposureScale?.[i] ?? 1);
      const scaledExposure = Math.min(1, vt.exposure * scale);
      const vtFactor = vt.exposure > 0 ? scaledExposure / vt.exposure : 0;
      const voltargetWeights = new Map(
        baseTargetList.map((target) => [
          target.assetId,
          target.weight * vt.exposure * vtFactor,
        ]),
      );
      voltarget = rebalanceBacktestBook(
        voltarget.cash,
        voltarget.units,
        executionPrices,
        voltargetWeights,
        tradeCosts,
      );
      voltargetCosts = addBacktestCost(voltargetCosts, voltarget);

      // Trend+Vol combo: momentum decides WHAT to hold, the vol-target exposure
      // decides HOW MUCH is invested. Momentum weights already sum ≤ 1 (its own
      // defensive cash), so scaling by exposure only ever gets more defensive.
      const trendvolWeights = new Map<InstrumentKey, number>();
      for (const [id, w] of momentumWeights) trendvolWeights.set(id, w * scaledExposure);
      trendvol = rebalanceBacktestBook(
        trendvol.cash,
        trendvol.units,
        executionPrices,
        trendvolWeights,
        tradeCosts,
      );
      trendvolCosts = addBacktestCost(trendvolCosts, trendvol);
    }

    holdEq.push({ t: tIdx, value: backtestBookValue(hold.cash, hold.units, prices) });
    passiveEq.push({ t: tIdx, value: backtestBookValue(passive.cash, passive.units, prices) });
    signalEq.push({ t: tIdx, value: backtestBookValue(signal.cash, signal.units, prices) });
    momentumEq.push({ t: tIdx, value: backtestBookValue(momentum.cash, momentum.units, prices) });
    voltargetEq.push({ t: tIdx, value: backtestBookValue(voltarget.cash, voltarget.units, prices) });
    trendvolEq.push({ t: tIdx, value: backtestBookValue(trendvol.cash, trendvol.units, prices) });
    rotationEq.push({ t: tIdx, value: backtestBookValue(rotation.cash, rotation.units, prices) });
  }

  return {
    runAtMs,
    hold: { equity: holdEq, metrics: metricsFrom(holdEq), costs: holdCosts },
    passive: { equity: passiveEq, metrics: metricsFrom(passiveEq), costs: passiveCosts },
    signal: { equity: signalEq, metrics: metricsFrom(signalEq), costs: signalCosts },
    momentum: { equity: momentumEq, metrics: metricsFrom(momentumEq), costs: momentumCosts },
    voltarget: { equity: voltargetEq, metrics: metricsFrom(voltargetEq), costs: voltargetCosts },
    trendvol: { equity: trendvolEq, metrics: metricsFrom(trendvolEq), costs: trendvolCosts },
    rotation: { equity: rotationEq, metrics: metricsFrom(rotationEq), costs: rotationCosts },
    // Hold is the benchmark, not a searched strategy — deflate over the active tracks only.
    significance: computeSignificance(
      {
        passive: passiveEq,
        signal: signalEq,
        momentum: momentumEq,
        voltarget: voltargetEq,
        trendvol: trendvolEq,
        rotation: rotationEq,
      },
      opts.trialRegistry ? trialCountForSignificance(opts.trialRegistry) ?? undefined : undefined,
    ),
    // Out-of-sample: does picking the leader-so-far each period beat holding/passive?
    walkForward: walkForwardSelection(
      {
        passive: equityReturns(passiveEq),
        signal: equityReturns(signalEq),
        momentum: equityReturns(momentumEq),
        voltarget: equityReturns(voltargetEq),
        trendvol: equityReturns(trendvolEq),
        rotation: equityReturns(rotationEq),
      },
      { passive: equityReturns(passiveEq), hold: equityReturns(holdEq) },
    ),
    assets,
    days: L - start,
    rebalanceEveryDays: opts.rebalanceEveryDays,
  };
}

/**
 * Canonical decision entry point. It accepts only a completed, timestamp-aligned
 * dataset and never treats close-only compatibility rows as observed opens.
 */
export function backtestDecisionDataset(
  dataset: DecisionMarketDataset,
  baseTargets: { assetId: InstrumentKey; weight: number }[],
  opts: Omit<StrategyBacktestOptions, 'executionPricesById'>,
): DecisionStrategyBacktestResult {
  const hasObservedOpens = dataset.assets.every((assetId) =>
    (dataset.barsById[assetId] ?? []).every(
      (bar) => (bar.quality ?? 'reported_ohlc') === 'reported_ohlc',
    ),
  );
  const executionModel = hasObservedOpens ? 'next_open' : 'next_close_conservative';
  const result = backtestStrategies(dataset.closesById, baseTargets, {
    ...opts,
    ...(hasObservedOpens ? { executionPricesById: dataset.opensById } : {}),
  });
  return { ...result, executionModel, datasetHash: dataset.report.datasetHash };
}
