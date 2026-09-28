import { canonicalJson, instrumentKey, ML_SIGNAL_VERSION, ML_SIDE_COST, predictMlSignal,
  proposeMlTarget, sha256Hex, trainMlSignal, type DecisionMarketDataset, type MlSignalRow } from '@coqui/core';
import type { MlHourlyBar } from '@coqui/storage';

import { PARALLEL_INSTRUMENTS, parallelAnchor, parallelDecision } from './parallel-signal.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SYMBOLS = ['BTC-USD', 'ETH-USD', 'LTC-USD'] as const;
const TRAIN_DAYS = 120, DEVELOPMENT_DAYS = 60, HOLDOUT_DAYS = 90;
const MIN_COVERAGE = 0.95;

export interface MlSignalSnapshot {
  readonly version: typeof ML_SIGNAL_VERSION;
  readonly datasetHash: string;
  readonly modelHash: string | null;
  readonly gate: 'qualified' | 'unqualified' | 'collecting';
  readonly reason: string;
  readonly predictedAtMs: number | null;
  readonly prediction: readonly number[] | null;
  readonly proposedWeights: readonly number[] | null;
  readonly baselineWeights: readonly number[] | null;
  readonly expectedNetImprovement: number | null;
  readonly evidence: {
    readonly developmentSlots: number; readonly holdoutSlots: number;
    readonly baselineReturnPct: number; readonly mlReturnPct: number;
    readonly liftPct: number; readonly stressLiftPct: number;
    readonly maxDrawdownPct: number; readonly turnover: number;
    readonly tradeCount: number; readonly lift95LowPct: number; readonly lift95HighPct: number;
  } | null;
}

interface Observation { readonly atMs: number; readonly features: readonly (readonly number[])[];
  readonly forwardReturns: readonly number[] | null; readonly baseline: readonly number[] }

function dailyDataset(days: readonly string[], closes: readonly (readonly number[])[]): DecisionMarketDataset {
  return { dayKeys: [...days], closesById: Object.fromEntries(PARALLEL_INSTRUMENTS.map((item, asset) =>
    [instrumentKey(item), closes[asset]!])), } as DecisionMarketDataset;
}

function observations(bars: readonly MlHourlyBar[], throughMs: number,
  studyEndMs: number): readonly Observation[] {
  const byAsset = SYMBOLS.map((symbol) => new Map(bars.filter((bar) => bar.productId === symbol)
    .map((bar) => [bar.startTimeMs, bar])));
  const startDay = Math.floor(Math.min(...bars.map((bar) => bar.startTimeMs)) / DAY) * DAY;
  const endDay = Math.floor(throughMs / DAY) * DAY;
  const days: string[] = [], closes: number[][] = [[], [], []];
  for (let day = startDay; day < endDay; day += DAY) {
    const values = byAsset.map((map) => Number(map.get(day + 23 * HOUR)?.close));
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) continue;
    days.push(new Date(day).toISOString().slice(0, 10));
    values.forEach((value, asset) => closes[asset]!.push(value));
  }
  const anchorStartMs = studyEndMs - (121 + TRAIN_DAYS + DEVELOPMENT_DAYS + HOLDOUT_DAYS) * DAY;
  const anchorIndex = days.indexOf(new Date(anchorStartMs).toISOString().slice(0, 10));
  if (anchorIndex < 0 || days.length - anchorIndex < 391 ||
      Date.parse(`${days[anchorIndex + 120]}T00:00:00Z`) - anchorStartMs !== 120 * DAY) return [];
  // A historical experiment starts with precisely 121 consecutive completed daily bars.
  const anchor = parallelAnchor(dailyDataset(days.slice(anchorIndex, anchorIndex + 121),
    closes.map((row) => row.slice(anchorIndex, anchorIndex + 121))));
  const baselineByDay = new Map<string, readonly number[]>();
  for (let index = anchorIndex + 120; index < days.length; index += 1) {
    const prior = days[index - 120]!;
    if (Date.parse(`${days[index]}T00:00:00Z`) - Date.parse(`${prior}T00:00:00Z`) !== 120 * DAY) continue;
    const decision = parallelDecision(dailyDataset(days.slice(anchorIndex, index + 1),
      closes.map((row) => row.slice(anchorIndex, index + 1))), anchor);
    baselineByDay.set(days[index]!, PARALLEL_INSTRUMENTS.map((item) => decision.weights[instrumentKey(item)] ?? 0));
  }
  const result: Observation[] = [];
  for (let atMs = anchorStartMs + 121 * DAY; atMs <= Math.floor(throughMs / HOUR) * HOUR; atMs += 4 * HOUR) {
    if (new Date(atMs).getUTCHours() === 0) continue;
    const priorDay = new Date(atMs - DAY).toISOString().slice(0, 10);
    const baseline = baselineByDay.get(priorDay);
    if (baseline === undefined) continue;
    const returns24: number[] = [];
    const features = byAsset.map((map) => {
      const close = (offset: number) => Number(map.get(atMs - offset * HOUR)?.close);
      const last = close(1), four = close(5), day = close(25), week = close(169);
      const sequence = Array.from({ length: 25 }, (_, index) => close(index + 1));
      if ([last, four, day, week, ...sequence].some((value) => !Number.isFinite(value) || value <= 0)) return null;
      const changes = sequence.slice(0, -1).map((value, index) => Math.log(value / sequence[index + 1]!));
      const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
      const vol = Math.sqrt(changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / changes.length);
      const r24 = last / day - 1;
      returns24.push(r24);
      return [last / four - 1, r24, last / week - 1, vol, 0];
    });
    if (features.some((row) => row === null)) continue;
    const mean24 = returns24.reduce((a, b) => a + b, 0) / 3;
    const validFeatures = features.map((row, asset) => {
      const copy = [...row!]; copy[4] = returns24[asset]! - mean24; return copy;
    });
    const future = byAsset.map((map) => {
      const open = Number(map.get(atMs)?.open), end = Number(map.get(atMs + 3 * HOUR)?.close);
      if (!Number.isFinite(open) || !Number.isFinite(end) || open <= 0 || end <= 0 ||
          [0, 1, 2, 3].some((offset) => !map.has(atMs + offset * HOUR))) return NaN;
      return end / open - 1;
    });
    result.push({ atMs, features: validFeatures,
      forwardReturns: future.every(Number.isFinite) ? future : null, baseline });
  }
  return result;
}

function runPortfolio(rows: readonly { readonly row: MlSignalRow; readonly target: readonly number[] }[],
  stress: number, baselineOnly: boolean) {
  let equity = 1, weights = [0, 0, 0], peak = 1, drawdown = 0, turnover = 0, trades = 0;
  const daily = new Map<string, number>();
  for (const { row, target } of rows) {
    const desired = baselineOnly ? row.baseline : target;
    const adjusted = desired.map((weight, asset) => Math.abs(weight - weights[asset]!) >= 0.01 ? weight : weights[asset]!);
    const traded = adjusted.reduce((sum, weight, asset) => sum + Math.abs(weight - weights[asset]!), 0);
    if (traded > 0) { equity *= 1 - traded * ML_SIDE_COST * stress; turnover += traded; trades += 1; }
    weights = adjusted;
    const growth = 1 + weights.reduce((sum, weight, asset) => sum + weight * row.forwardReturns[asset]!, 0);
    equity *= growth;
    weights = weights.map((weight, asset) => weight * (1 + row.forwardReturns[asset]!) / growth);
    peak = Math.max(peak, equity); drawdown = Math.max(drawdown, (peak - equity) / peak);
    daily.set(new Date(row.atMs).toISOString().slice(0, 10), equity);
  }
  return { equity, drawdown, turnover, trades, daily: [...daily.values()] };
}

function uncertainty(base: readonly number[], overlay: readonly number[]): readonly [number, number] {
  const changes = overlay.map((value, index) => (value / (overlay[index - 1] ?? 1) - 1) -
    (base[index]! / (base[index - 1] ?? 1) - 1));
  if (changes.length < 14) return [0, 0];
  let seed = 0x12345678;
  const draws: number[] = [];
  for (let attempt = 0; attempt < 500; attempt += 1) {
    let sum = 0;
    for (let sampled = 0; sampled < changes.length; sampled += 7) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const start = seed % Math.max(1, changes.length - 6);
      for (let offset = 0; offset < Math.min(7, changes.length - sampled); offset += 1) sum += changes[start + offset]!;
    }
    draws.push(sum * 100);
  }
  draws.sort((a, b) => a - b);
  return [draws[12]!, draws[487]!];
}

/** No network, credentials, storage, or broker dependency enters this worker. */
export function evaluateParallelMlSignal(input: { readonly bars: readonly MlHourlyBar[];
  readonly nowMs: number; readonly studyEndMs: number; readonly functionalChecksPassed: boolean }): MlSignalSnapshot {
  const datasetHash = sha256Hex(canonicalJson(input.bars.filter((bar) => bar.startTimeMs < input.studyEndMs).map((bar) =>
    [bar.productId, bar.startTimeMs, bar.open, bar.close, bar.source]) as never));
  const base: MlSignalSnapshot = { version: ML_SIGNAL_VERSION, datasetHash, modelHash: null, gate: 'collecting',
    reason: 'hourly_history_incomplete', predictedAtMs: null, prediction: null,
    proposedWeights: null, baselineWeights: null, expectedNetImprovement: null, evidence: null };
  const observationsWithFuture = observations(input.bars, input.nowMs, input.studyEndMs);
  if (observationsWithFuture.length === 0) return base;
  const lastDay = input.studyEndMs;
  const holdoutStart = lastDay - HOLDOUT_DAYS * DAY;
  const developmentStart = holdoutStart - DEVELOPMENT_DAYS * DAY;
  const trainStart = developmentStart - TRAIN_DAYS * DAY;
  const rows = observationsWithFuture.filter((item): item is Observation & { forwardReturns: readonly number[] } =>
    item.forwardReturns !== null).map((item) => ({ ...item, forwardReturns: item.forwardReturns }));
  const count = (from: number, to: number) => rows.filter((row) => row.atMs >= from && row.atMs < to).length;
  if (count(trainStart, developmentStart) < TRAIN_DAYS * 5 * MIN_COVERAGE ||
      count(developmentStart, holdoutStart) < DEVELOPMENT_DAYS * 5 * MIN_COVERAGE ||
      count(holdoutStart, lastDay) < HOLDOUT_DAYS * 5 * MIN_COVERAGE) return base;
  const testRows = rows.filter((row) => row.atMs >= developmentStart && row.atMs < lastDay);
  let model = trainMlSignal(rows.filter((row) => row.atMs >= trainStart && row.atMs < developmentStart));
  let trainedWeek = -1;
  const evaluated = testRows.map((row) => {
    const week = Math.floor((row.atMs - developmentStart) / (7 * DAY));
    if (week !== trainedWeek) {
      const training = rows.filter((candidate) => candidate.atMs >= row.atMs - TRAIN_DAYS * DAY &&
        candidate.atMs + 4 * HOUR <= row.atMs);
      model = trainMlSignal(training); trainedWeek = week;
    }
    const prediction = predictMlSignal(model, row.features);
    return { row, target: proposeMlTarget(row.baseline, prediction).weights };
  });
  const holdout = evaluated.filter(({ row }) => row.atMs >= holdoutStart);
  const baseline = runPortfolio(holdout, 1, true);
  const overlay = runPortfolio(holdout, 1, false);
  const stressed = runPortfolio(holdout, 2, false);
  const stressedBaseline = runPortfolio(holdout, 2, true);
  const [low, high] = uncertainty(baseline.daily, overlay.daily);
  const liftPct = (overlay.equity - baseline.equity) * 100;
  const evidence = { developmentSlots: evaluated.length - holdout.length, holdoutSlots: holdout.length,
    baselineReturnPct: (baseline.equity - 1) * 100, mlReturnPct: (overlay.equity - 1) * 100,
    liftPct, stressLiftPct: (stressed.equity - stressedBaseline.equity) * 100,
    maxDrawdownPct: overlay.drawdown * 100, turnover: overlay.turnover,
    tradeCount: overlay.trades, lift95LowPct: low, lift95HighPct: high };
  const latest = observationsWithFuture.at(-1)!;
  const date = new Date(input.nowMs);
  const todayStart = Math.floor(input.nowMs / DAY) * DAY;
  const weekStart = todayStart - ((date.getUTCDay() + 6) % 7) * DAY;
  const liveTraining = rows.filter((row) => row.atMs >= weekStart - TRAIN_DAYS * DAY &&
    row.atMs + 4 * HOUR <= weekStart);
  if (liveTraining.length < 400) return { ...base, evidence };
  const liveModel = trainMlSignal(liveTraining);
  const modelHash = sha256Hex(canonicalJson(liveModel as never));
  const prediction = predictMlSignal(liveModel, latest.features);
  const proposal = proposeMlTarget(latest.baseline, prediction);
  const qualified = liftPct > 0 && input.functionalChecksPassed;
  return { version: ML_SIGNAL_VERSION, datasetHash, modelHash,
    gate: qualified ? 'qualified' : 'unqualified',
    reason: liftPct <= 0 ? 'holdout_net_lift_nonpositive' :
      !input.functionalChecksPassed ? 'functional_checks_pending' : 'qualified',
    predictedAtMs: latest.atMs, prediction, baselineWeights: latest.baseline,
    proposedWeights: proposal.weights, expectedNetImprovement: proposal.expectedNetImprovement, evidence };
}
