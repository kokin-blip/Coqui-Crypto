import {
  addBacktestCost,
  backtestBookValue,
  normalizeBacktestWeights,
  rebalanceBacktestBook,
} from '../backtest/engine.js';
import { metricsFrom } from '../backtest/analytics.js';
import type {
  EquityPoint,
  StrategyBacktestOptions,
  StrategyCostSummary,
  TrackResult,
} from '../backtest/types.js';
import { DEFAULT_TRADE_COST_CONFIG } from '../costs/index.js';
import type { DecisionMarketDataset } from '../market/index.js';
import { momentumTargetsAt } from '../strategies/momentum.js';
import { volTargetExposureAt } from '../strategies/vol-target.js';
import type { InstrumentKey } from '../types/index.js';

const START_VALUE = 10_000;
const YEAR = 365;
const EMPTY_COSTS: StrategyCostSummary = {
  turnoverUsd: 0,
  totalCostUsd: 0,
  costPctOfStart: 0,
  events: 0,
};

export interface TrendVolResearchTracks {
  readonly hold: TrackResult;
  readonly passive: TrackResult;
  readonly trendvol: TrackResult;
  readonly executionModel: 'next_open' | 'next_close_conservative';
  readonly datasetHash: string;
}

type TrendVolResearchOptions = Pick<
  StrategyBacktestOptions,
  | 'warmup'
  | 'rebalanceEveryDays'
  | 'momentum'
  | 'volTarget'
  | 'tradeCosts'
  | 'cashAprPct'
  | 'exposureScale'
>;

function initialCosts(event: { turnoverUsd: number; costUsd: number }): StrategyCostSummary {
  return {
    turnoverUsd: event.turnoverUsd,
    totalCostUsd: event.costUsd,
    costPctOfStart: (event.costUsd / START_VALUE) * 100,
    events: event.turnoverUsd > 0 ? 1 : 0,
  };
}

function emptyTracks(dataset: DecisionMarketDataset): TrendVolResearchTracks {
  const empty: TrackResult = { equity: [], metrics: metricsFrom([]), costs: EMPTY_COSTS };
  return {
    hold: empty,
    passive: empty,
    trendvol: empty,
    executionModel: 'next_close_conservative',
    datasetHash: dataset.report.datasetHash,
  };
}

/**
 * Evaluate only the three tracks used by registered trend-vol research. Timing,
 * next-interval execution, costs, and rebalancing use the authoritative
 * backtest primitives; unrelated signal, momentum-only, vol-only, and rotation
 * tracks are never constructed.
 *
 * @internal The public nested-study result remains unchanged.
 */
export function evaluateTrendVolResearch(
  dataset: DecisionMarketDataset,
  baseTargets: { assetId: InstrumentKey; weight: number }[],
  options: TrendVolResearchOptions,
): TrendVolResearchTracks {
  const tradeCosts = options.tradeCosts ?? DEFAULT_TRADE_COST_CONFIG;
  const baseWeights = normalizeBacktestWeights(baseTargets);
  const assets = [...baseWeights.keys()].filter(
    (assetId) => (dataset.closesById[assetId]?.length ?? 0) > 0,
  );
  if (assets.length === 0) return emptyTracks(dataset);
  const length = Math.min(...assets.map((assetId) => dataset.closesById[assetId]!.length));
  if (length - options.warmup < 2) return emptyTracks(dataset);

  const series = new Map<InstrumentKey, number[]>(assets.map((assetId) => [
    assetId,
    dataset.closesById[assetId]!.slice(-length),
  ]));
  const hasObservedOpens = assets.every((assetId) =>
    (dataset.barsById[assetId] ?? []).every(
      (bar) => (bar.quality ?? 'reported_ohlc') === 'reported_ohlc',
    ),
  );
  const executionSeries = new Map<InstrumentKey, number[]>(assets.map((assetId) => [
    assetId,
    hasObservedOpens && dataset.opensById[assetId]?.length === length
      ? dataset.opensById[assetId]!
      : series.get(assetId)!,
  ]));
  const keptBase = normalizeBacktestWeights(
    assets.map((assetId) => ({ assetId, weight: baseWeights.get(assetId) ?? 0 })),
  );
  const targetList = assets.map((assetId) => ({
    assetId,
    weight: keptBase.get(assetId) ?? 0,
  }));
  const pricesAt = (values: Map<InstrumentKey, number[]>, index: number) =>
    new Map(assets.map((assetId) => [assetId, values.get(assetId)![index]!]));

  const mixIndex: number[] = [];
  for (let index = 0; index < length; index += 1) {
    let value = 0;
    for (const assetId of assets) {
      const initial = series.get(assetId)![0]!;
      if (initial > 0) {
        value += (keptBase.get(assetId) ?? 0) * (series.get(assetId)![index]! / initial);
      }
    }
    mixIndex.push(value);
  }

  const initialize = () => rebalanceBacktestBook(
    START_VALUE,
    new Map(),
    pricesAt(executionSeries, options.warmup),
    keptBase,
    tradeCosts,
  );
  const hold = initialize();
  let passive = initialize();
  let trendvol = initialize();
  const holdCosts = initialCosts(hold);
  let passiveCosts = initialCosts(passive);
  let trendvolCosts = initialCosts(trendvol);
  const holdEquity: EquityPoint[] = [];
  const passiveEquity: EquityPoint[] = [];
  const trendvolEquity: EquityPoint[] = [];
  const cashGrowthDaily = options.cashAprPct && options.cashAprPct > 0
    ? Math.pow(1 + options.cashAprPct / 100, 1 / YEAR)
    : 1;

  for (let index = options.warmup; index < length; index += 1) {
    const trackIndex = index - options.warmup;
    const prices = pricesAt(series, index);
    const executionPrices = pricesAt(executionSeries, index);
    if (cashGrowthDaily !== 1 && trackIndex > 0) {
      hold.cash *= cashGrowthDaily;
      passive.cash *= cashGrowthDaily;
      trendvol.cash *= cashGrowthDaily;
    }
    if (trackIndex > 0 && trackIndex % options.rebalanceEveryDays === 0) {
      passive = rebalanceBacktestBook(
        passive.cash,
        passive.units,
        executionPrices,
        keptBase,
        tradeCosts,
      );
      passiveCosts = addBacktestCost(passiveCosts, passive);
      const momentum = momentumTargetsAt(targetList, series, index, options.momentum);
      const momentumWeights = momentum.stats.length > 0
        ? new Map(momentum.targets.map((target) => [target.assetId, target.weight]))
        : keptBase;
      const volatility = volTargetExposureAt(mixIndex, index, options.volTarget);
      const scale = Math.max(0, options.exposureScale?.[index] ?? 1);
      const exposure = Math.min(1, volatility.exposure * scale);
      const weights = new Map<InstrumentKey, number>();
      for (const [assetId, weight] of momentumWeights) weights.set(assetId, weight * exposure);
      trendvol = rebalanceBacktestBook(
        trendvol.cash,
        trendvol.units,
        executionPrices,
        weights,
        tradeCosts,
      );
      trendvolCosts = addBacktestCost(trendvolCosts, trendvol);
    }
    holdEquity.push({
      t: trackIndex,
      value: backtestBookValue(hold.cash, hold.units, prices),
    });
    passiveEquity.push({
      t: trackIndex,
      value: backtestBookValue(passive.cash, passive.units, prices),
    });
    trendvolEquity.push({
      t: trackIndex,
      value: backtestBookValue(trendvol.cash, trendvol.units, prices),
    });
  }

  return {
    hold: { equity: holdEquity, metrics: metricsFrom(holdEquity), costs: holdCosts },
    passive: { equity: passiveEquity, metrics: metricsFrom(passiveEquity), costs: passiveCosts },
    trendvol: { equity: trendvolEquity, metrics: metricsFrom(trendvolEquity), costs: trendvolCosts },
    executionModel: hasObservedOpens ? 'next_open' : 'next_close_conservative',
    datasetHash: dataset.report.datasetHash,
  };
}
