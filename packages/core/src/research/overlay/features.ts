import { sourceCompletionDelayMs, type DecisionMarketDataset } from '../../market/index.js';
import { decisionFrameAt } from '../../backtest/execution-timing.js';
import type { OverlayArm, OverlayRow } from './types.js';
const DAY = 86_400_000;
export function dailyOverlayFeatures(closes: readonly (readonly number[])[]): number[][] | null {
  if (!closes.length || closes.some((values) => values.length !== closes[0]!.length || values.length < 31 || values.some((v) => !Number.isFinite(v) || v <= 0))) return null;
  const features = closes.map((values) => {
    const end = values.length - 1, price = values[end]!;
    const returns = values.slice(end - 30).slice(1).map((p, i) => p / values[end - 30 + i]! - 1);
    const mean = returns.reduce((a, b) => a + b, 0) / 30;
    return [price / values[end - 1]! - 1, price / values[end - 7]! - 1,
      price / values[end - 30]! - 1, Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / 30) * Math.sqrt(365), 0];
  });
  const relative = features.reduce((s, row) => s + row[1]!, 0) / features.length;
  features.forEach((row) => { row[4] = row[1]! - relative; }); return features;
}
export function scheduledOverlay(atMs: number, arm: OverlayArm): boolean {
  return atMs >= arm.anchorMs && (atMs - arm.anchorMs) % (arm.cadence * DAY) === 0;
}
export function overlayRows(dataset: DecisionMarketDataset, arm: OverlayArm): OverlayRow[] {
  const rows: OverlayRow[] = [];
  for (let index = 31; index + arm.cadence < dataset.dayKeys.length; index++) {
    const frame = decisionFrameAt(dataset, index), end = index + arm.cadence;
    if (!scheduledOverlay(frame.executionAtMs, arm)) continue;
    const features = dailyOverlayFeatures(dataset.assets.map((asset) => dataset.closesById[asset]!.slice(0, frame.observedEndExclusive)));
    if (!features) continue;
    const labelBars = dataset.assets.map((asset) => dataset.barsById[asset]![end]!);
    rows.push({ decisionAtMs: frame.decisionAtMs, executionAtMs: frame.executionAtMs,
      labelEndMs: labelBars[0]!.startTimeMs,
      labelAvailableAtMs: Math.max(...labelBars.map((bar) => bar.endTimeMs + sourceCompletionDelayMs(bar.source))), features,
      forwardReturns: dataset.assets.map((asset) => dataset.opensById[asset]![end]! / dataset.opensById[asset]![index]! - 1) });
  }
  return rows;
}
/** The entire outcome must be available strictly before the following partition. */
export function maturedRows(rows: readonly OverlayRow[], startMs: number, boundaryMs: number): OverlayRow[] {
  return rows.filter((row) => row.executionAtMs >= startMs && row.executionAtMs < boundaryMs &&
    row.labelEndMs < boundaryMs && row.labelAvailableAtMs < boundaryMs);
}
