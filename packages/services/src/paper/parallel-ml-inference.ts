import { canonicalJson, ML_SIGNAL_VERSION, predictMlSignal, proposeMlTarget, sha256Hex,
  trainMlSignal, type MlSignalRow } from '@coqui/core';
import type { MlHourlyBar } from '@coqui/storage';
import type { MlSignalSnapshot } from './parallel-ml-worker.js';

export const ML_INFERENCE_VERSION = 'trendvol-ml-ridge-shadow-v2' as const;
const HOUR = 3_600_000, DAY = 24 * HOUR;
const SYMBOLS = ['BTC-USD', 'ETH-USD', 'LTC-USD'] as const;
export const ML_INFERENCE_PLAN = { version: ML_INFERENCE_VERSION, modelVersion: ML_SIGNAL_VERSION,
  trainDays: 120, minimumCoverage: 0.95, model: 'ridge-l2-10', labelHours: 4,
  features: ['return4h', 'return24h', 'return7d', 'vol24h', 'relative24h'],
  sideCost: 0.005, maximumDelta: 0.10, refresh: 'utc-monday', mode: 'shadow' } as const;

/** Exact per-asset completeness, without fabricating absent or unfinished bars. */
export function completeMlWindow(bars: readonly MlHourlyBar[], from: number, to: number,
  products: readonly MlHourlyBar['productId'][] = SYMBOLS): boolean {
  if (from % HOUR || to % HOUR || to <= from) return false;
  const keys = new Set(bars.filter(validBar).map((bar) => `${bar.productId}:${bar.startTimeMs}`));
  for (let at = from; at < to; at += HOUR) for (const symbol of products) {
    if (!keys.has(`${symbol}:${at}`)) return false;
  }
  return true;
}
function validBar(bar: MlHourlyBar): boolean {
  const values = [bar.open, bar.high, bar.low, bar.close].map(Number);
  return SYMBOLS.includes(bar.productId) && bar.startTimeMs % HOUR === 0 &&
    ['authenticated', 'public'].includes(bar.source) && Number.isSafeInteger(bar.retrievedAtMs) &&
    bar.retrievedAtMs >= bar.startTimeMs + HOUR && values.every((value) => Number.isFinite(value) && value > 0) &&
    values[1]! >= Math.max(values[0]!, values[3]!) && values[2]! <= Math.min(values[0]!, values[3]!);
}

/** Inference never invokes a historical evaluator, studies, or broker operations. */
export function inferParallelMlSignal(input: { bars: readonly MlHourlyBar[]; nowMs: number;
  baseline: readonly number[]; behaviorHash: string;
  protectedPeriods?: readonly { startMs: number; endMs: number }[] }): MlSignalSnapshot {
  const slotMs = Math.floor(input.nowMs / (4 * HOUR)) * 4 * HOUR;
  const date = new Date(slotMs), dayStart = Math.floor(slotMs / DAY) * DAY;
  const trainingCutoffMs = dayStart - ((date.getUTCDay() + 6) % 7) * DAY;
  const eligible = date.getUTCHours() !== 0 && input.nowMs < slotMs + 15 * 60_000;
  const bars = input.bars.filter((bar) => validBar(bar) && bar.startTimeMs + HOUR <= input.nowMs)
    .sort((a, b) => a.startTimeMs - b.startTimeMs || a.productId.localeCompare(b.productId));
  const datasetHash = sha256Hex(canonicalJson(bars as never));
  const base: MlSignalSnapshot = { version: ML_INFERENCE_VERSION, datasetHash, modelHash: null,
    gate: 'collecting', reason: eligible ? 'hourly_history_incomplete' : 'outside_shadow_window',
    predictedAtMs: null, prediction: null, proposedWeights: null, baselineWeights: null,
    expectedNetImprovement: null, evidence: null,
    provenance: { behaviorHash: input.behaviorHash, planHash: sha256Hex(canonicalJson(ML_INFERENCE_PLAN as never)),
      trainingCutoffMs, slotMs, capturedAtMs: input.nowMs, trainingRows: 0 } };
  if (!eligible || !/^[a-f0-9]{64}$/u.test(input.behaviorHash)) return base;
  const maps = SYMBOLS.map((symbol) => new Map(bars.filter((bar) => bar.productId === symbol)
    .map((bar) => [bar.startTimeMs, bar])));
  const featuresAt = (at: number): number[][] | null => {
    const features: number[][] = [];
    for (const map of maps) {
      for (let offset = 1; offset <= 169; offset += 1) if (!map.has(at - offset * HOUR)) return null;
      const close = (offset: number) => Number(map.get(at - offset * HOUR)!.close);
      const changes = Array.from({ length: 24 }, (_, index) => Math.log(close(index + 1) / close(index + 2)));
      const mean = changes.reduce((sum, value) => sum + value, 0) / 24;
      features.push([close(1) / close(5) - 1, close(1) / close(25) - 1, close(1) / close(169) - 1,
        Math.sqrt(changes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 24), 0]);
    }
    const relative = features.reduce((sum, row) => sum + row[1]!, 0) / 3;
    features.forEach((row) => { row[4] = row[1]! - relative; });
    return features;
  };
  const latest = featuresAt(slotMs);
  if (!latest) return { ...base, reason: 'current_feature_window_incomplete' };
  const rows: MlSignalRow[] = [];
  for (let at = trainingCutoffMs - 120 * DAY; at + 4 * HOUR <= trainingCutoffMs; at += 4 * HOUR) {
    if (new Date(at).getUTCHours() === 0 || input.protectedPeriods?.some((period) =>
      at < period.endMs && at + 4 * HOUR > period.startMs)) continue;
    const features = featuresAt(at);
    if (!features || maps.some((map) => [0, 1, 2, 3].some((offset) => !map.has(at + offset * HOUR)))) continue;
    const forwardReturns = maps.map((map) => Number(map.get(at + 3 * HOUR)!.close) / Number(map.get(at)!.open) - 1);
    rows.push({ atMs: at, features, forwardReturns, baseline: [0, 0, 0] });
  }
  if (rows.length < 120 * 5 * 0.95) return { ...base, reason: 'training_coverage_incomplete' };
  const model = trainMlSignal(rows), prediction = predictMlSignal(model, latest);
  const proposal = proposeMlTarget(input.baseline, prediction);
  return { ...base, gate: 'unqualified', reason: 'fresh_shadow_proposal_no_performance_gate',
    modelHash: sha256Hex(canonicalJson(model as never)), predictedAtMs: slotMs, prediction,
    baselineWeights: input.baseline, proposedWeights: proposal.weights,
    expectedNetImprovement: proposal.expectedNetImprovement,
    provenance: { ...base.provenance!, trainingRows: rows.length } };
}
