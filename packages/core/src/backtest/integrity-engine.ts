import { Decimal } from 'decimal.js';
import { tradeCostConfigHash, DEFAULT_TRADE_COST_CONFIG } from '../costs/index.js';
import type { DecisionMarketDataset } from '../market/index.js';
import { rotationTargets, tiltTargets, DEFAULT_TILT_CONFIG } from '../strategies/index.js';
import { momentumTargetsAt, momentumMinimumHistory } from '../strategies/momentum.js';
import { volTargetExposureAt, volTargetMinimumHistory } from '../strategies/vol-target.js';
import { composeTrendVolTargets } from '../strategies/trend-vol.js';
import type { InstrumentKey } from '../types/index.js';
import { trialCountForSignificance } from '../trials/index.js';
import { walkForwardSelection } from '../validation/index.js';
import { computeSignificance, equityReturns, metricsFrom } from './analytics.js';
import { normalizeBacktestWeights } from './engine.js';
import { decisionFrameAt, validateDecisionDataset, validateTimedExposure,
  INTEGRITY_ENGINE_VERSION, type TimedExposure, type ValidatedDecisionFrame } from './execution-timing.js';
import { rebalanceResearchBook, researchBookValue, type ResearchBook, type ResearchFill } from './integrity-book.js';
import type { ConcreteAutoStrategy, DecisionStrategyBacktestResult, EquityPoint,
  StrategyBacktestOptions, TrackResult } from './types.js';

const FAMILIES = ['hold', 'passive', 'signal', 'momentum', 'voltarget', 'trendvol', 'rotation', 'cash'] as const;
export type IntegrityFamily = typeof FAMILIES[number];
export interface ResearchDecisionTrace {
  readonly frame: ValidatedDecisionFrame;
  readonly targets: readonly { assetId: InstrumentKey; weight: number }[];
  readonly reason: 'baseline' | 'strategy' | 'insufficient_history' | 'not_scheduled';
  readonly fills: readonly ResearchFill[];
  readonly cash: string;
  readonly units: Readonly<Record<string, string>>;
}
export interface IntegrityTrackResult extends TrackResult {
  readonly traces: readonly ResearchDecisionTrace[];
  readonly componentCosts: Readonly<{ fee: string; spread: string; slippage: string; impact: string }>;
}
export interface IntegrityBacktestResult extends DecisionStrategyBacktestResult {
  readonly engineVersion: typeof INTEGRITY_ENGINE_VERSION;
  readonly costProfileHash: string;
  readonly confirmatoryEligible: boolean;
  readonly universeAssumption: 'conditional_fixed_universe';
  readonly cash: IntegrityTrackResult;
  readonly tracesByStrategy: Readonly<Record<IntegrityFamily, readonly ResearchDecisionTrace[]>>;
}
export type IntegrityOptions = Omit<StrategyBacktestOptions, 'executionPricesById'> & {
  readonly timedExposure?: readonly TimedExposure[];
  readonly benchmarkRebalanceEveryDays?: number;
  readonly minimumHistoryBars?: number;
};

/** No execution prices or future observations are passed to the target functions. */
function targetsAt(family: IntegrityFamily, base: { assetId: InstrumentKey; weight: number }[],
  series: ReadonlyMap<InstrumentKey, readonly number[]>, mix: readonly number[],
  frame: ValidatedDecisionFrame, options: IntegrityOptions, held: readonly InstrumentKey[]) {
  const end = frame.observedEndExclusive;
  const defaultWeights = new Map(base.map((target) => [target.assetId, target.weight]));
  if (family === 'cash') return { weights: new Map<InstrumentKey, number>(), reason: 'baseline' as const };
  if (family === 'hold' || family === 'passive') return { weights: defaultWeights, reason: 'baseline' as const };
  const history = new Map([...series].map(([id, values]) => [id, values.slice(0, end)]));
  const prefixes = Object.fromEntries(history);
  const mom = momentumTargetsAt(base, history, end, options.momentum);
  const vt = volTargetExposureAt(mix.slice(0, end), end, options.volTarget);
  const scale = options.timedExposure
    ? validateTimedExposure(frame, options.timedExposure[frame.executionIndex]!) : 1;
  if (end < (options.minimumHistoryBars ?? options.warmup) ||
      (['momentum', 'trendvol'].includes(family) && (end < momentumMinimumHistory(options.momentum) || mom.stats.length !== base.length)) ||
      (['voltarget', 'trendvol'].includes(family) && (end < volTargetMinimumHistory(options.volTarget) || vt.realizedVolPct === null))) {
    return { weights: new Map<InstrumentKey, number>(), reason: 'insufficient_history' as const };
  }
  if (family === 'momentum') return { weights: new Map(mom.targets.map((t) => [t.assetId, t.weight])), reason: 'strategy' as const };
  if (family === 'voltarget') return { weights: new Map(base.map((t) => [t.assetId, t.weight * vt.exposure * scale])), reason: 'strategy' as const };
  if (family === 'trendvol') {
    const targets = composeTrendVolTargets(base, mom, vt, scale, end, options.momentum, options.volTarget).targets;
    return { weights: new Map(targets.map((t) => [t.assetId, t.weight])), reason: 'strategy' as const };
  }
  if (family === 'rotation') {
    const result = rotationTargets(prefixes, options.rotation, [...held]);
    return { weights: new Map(result.picks.map((p) => [p.assetId, p.weight])), reason: 'strategy' as const };
  }
  const signals = base.flatMap((target) => {
    const read = options.evalSignal([...(history.get(target.assetId) ?? [])]);
    return read ? [{ ...read, assetId: target.assetId }] : [];
  });
  const tilted = tiltTargets(base, signals, options.tilt ?? DEFAULT_TILT_CONFIG);
  return { weights: new Map(tilted.targets.map((t) => [t.assetId, t.weight])), reason: 'strategy' as const };
}

/** Corrected replay identity. Legacy array-only numerical fixtures retain their original engine. */
export function backtestIntegrityDataset(dataset: DecisionMarketDataset,
  baseTargets: { assetId: InstrumentKey; weight: number }[], options: IntegrityOptions): IntegrityBacktestResult {
  validateDecisionDataset(dataset);
  if (!Number.isSafeInteger(options.warmup) || options.warmup < 2 || options.warmup >= dataset.dayKeys.length ||
      !Number.isSafeInteger(options.rebalanceEveryDays) || options.rebalanceEveryDays < 1 ||
      options.exposureScale !== undefined || (options.timedExposure && options.timedExposure.length !== dataset.dayKeys.length)) {
    throw new TypeError('Invalid research warmup, cadence or unversioned exposure overlay');
  }
  if (options.minimumHistoryBars !== undefined && (!Number.isSafeInteger(options.minimumHistoryBars) || options.minimumHistoryBars < 2)) throw new TypeError('Invalid minimum history');
  if (options.benchmarkRebalanceEveryDays !== undefined && (!Number.isSafeInteger(options.benchmarkRebalanceEveryDays) || options.benchmarkRebalanceEveryDays < 1)) throw new TypeError('Invalid benchmark cadence');
  const costs = options.tradeCosts ?? DEFAULT_TRADE_COST_CONFIG;
  const costProfileHash = tradeCostConfigHash(costs);
  if (baseTargets.length === 0 || new Set(baseTargets.map((t) => t.assetId)).size !== baseTargets.length ||
      baseTargets.some((t) => !dataset.assets.includes(t.assetId) || !Number.isFinite(t.weight) || t.weight <= 0)) {
    throw new TypeError('Research requires explicit available base assets');
  }
  const baseWeights = normalizeBacktestWeights(baseTargets);
  const base = [...baseWeights].map(([assetId, weight]) => ({ assetId, weight }));
  const series = new Map(dataset.assets.map((asset) => [asset, dataset.closesById[asset]! as readonly number[]]));
  const mix = dataset.dayKeys.map((_, index) => base.reduce((sum, target) => sum +
    target.weight * dataset.closesById[target.assetId]![index]! / dataset.closesById[target.assetId]![0]!, 0));
  const observedOpens = dataset.assets.every((asset) => dataset.barsById[asset]!
    .every((bar) => (bar.quality ?? 'reported_ohlc') === 'reported_ohlc'));
  if (!observedOpens) throw new TypeError('Observed opens required; close-only compatibility is exploratory legacy evidence');
  const tracks = {} as Record<IntegrityFamily, IntegrityTrackResult>;
  for (const family of FAMILIES) {
    let book: ResearchBook = { cash: '10000', units: new Map() };
    const equity: EquityPoint[] = [{ t: -1, value: 10000 }];
    const traces: ResearchDecisionTrace[] = [];
    let turnover = new Decimal(0), fee = new Decimal(0), spread = new Decimal(0), slip = new Decimal(0), impact = new Decimal(0);
    let events = 0;
    for (let index = options.warmup; index < dataset.dayKeys.length; index += 1) {
      const frame = decisionFrameAt(dataset, index);
      const marks = new Map(dataset.assets.map((asset) => [asset, dataset.closesById[asset]![index]!]));
      const prices = new Map(dataset.assets.map((asset) => [asset,
        (observedOpens ? dataset.opensById : dataset.closesById)[asset]![index]!]));
      if (index > options.warmup && (options.cashAprPct ?? 0) > 0) {
        book = { ...book, cash: new Decimal(book.cash).mul(Math.pow(1 + options.cashAprPct! / 100, 1 / 365)).toFixed() };
      }
      const scheduled = family !== 'cash' && (index === options.warmup ||
        (family !== 'hold' && (index - options.warmup) %
          (family === 'passive' ? options.benchmarkRebalanceEveryDays ?? options.rebalanceEveryDays : options.rebalanceEveryDays) === 0));
      const target = scheduled ? targetsAt(family, base, series, mix, frame, options,
        [...book.units].filter(([, q]) => new Decimal(q).isPositive()).map(([id]) => id))
        : { weights: new Map<InstrumentKey, number>(), reason: 'not_scheduled' as const };
      const transition = scheduled ? rebalanceResearchBook(book, prices, target.weights, costs) : { book, fills: [] };
      book = transition.book;
      if (transition.fills.length > 0) events += 1;
      for (const fill of transition.fills) {
        turnover = turnover.add(fill.referenceNotional); fee = fee.add(fill.venueFee);
        spread = spread.add(fill.spreadCost); slip = slip.add(fill.slippageCost); impact = impact.add(fill.impactCost);
      }
      traces.push(Object.freeze({ frame, reason: target.reason,
        targets: [...target.weights].map(([assetId, weight]) => ({ assetId, weight })), fills: transition.fills,
        cash: book.cash, units: Object.freeze(Object.fromEntries(book.units)) }));
      equity.push({ t: index - options.warmup, value: researchBookValue(book, marks).toNumber() });
    }
    const total = fee.add(spread).add(slip).add(impact);
    tracks[family] = { equity, metrics: metricsFrom(equity), traces, componentCosts: {
      fee: fee.toFixed(), spread: spread.toFixed(), slippage: slip.toFixed(), impact: impact.toFixed() },
    costs: { turnoverUsd: turnover.toNumber(), totalCostUsd: total.toNumber(), costPctOfStart: total.div(100).toNumber(), events } };
  }
  const active = Object.fromEntries(FAMILIES.filter((family) => !['hold', 'cash'].includes(family))
    .map((family) => [family, tracks[family].equity]));
  return { ...tracks, runAtMs: options.clock.nowMs(), assets: base.map((t) => t.assetId),
    days: dataset.dayKeys.length - options.warmup, rebalanceEveryDays: options.rebalanceEveryDays,
    significance: computeSignificance(active, options.trialRegistry ? trialCountForSignificance(options.trialRegistry) ?? undefined : undefined),
    walkForward: walkForwardSelection(Object.fromEntries(Object.entries(active).map(([id, eq]) => [id, equityReturns(eq)])),
      { passive: equityReturns(tracks.passive.equity), hold: equityReturns(tracks.hold.equity) }),
    executionModel: observedOpens ? 'next_open' : 'next_close_conservative', datasetHash: dataset.report.datasetHash,
    engineVersion: INTEGRITY_ENGINE_VERSION, costProfileHash, confirmatoryEligible: observedOpens,
    universeAssumption: 'conditional_fixed_universe',
    tracesByStrategy: Object.fromEntries(FAMILIES.map((family) => [family, tracks[family].traces])) as Record<IntegrityFamily, readonly ResearchDecisionTrace[]> };
}

export function integrityTrack(result: IntegrityBacktestResult, family: ConcreteAutoStrategy): TrackResult {
  return result[family];
}
