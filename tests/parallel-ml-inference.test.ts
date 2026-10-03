import { describe, expect, it } from 'vitest';
import { inferParallelMlSignal, completeMlWindow, ML_INFERENCE_VERSION } from '../packages/services/src/paper/parallel-ml-inference.js';
import { projectParallelMlStatus } from '../packages/services/src/paper/parallel-ml-status.js';
import type { MlHourlyBar, ParallelPaperEvent } from '../packages/storage/src/index.js';
const HOUR = 3_600_000, DAY = 24 * HOUR, NOW = Date.parse('2026-10-01T04:01:00Z'), HASH = 'a'.repeat(64);
function history(nowMs = NOW): MlHourlyBar[] {
  const end = Math.floor(NOW / HOUR) * HOUR;
  return Array.from({ length: 140 * 24 + Math.floor((nowMs - NOW) / HOUR) }, (_, index) => ['BTC-USD', 'ETH-USD', 'LTC-USD'].map((symbol, asset) => {
    const price = 100 * (asset + 1) * (1 + index / 100_000);
    return { productId: symbol as MlHourlyBar['productId'], startTimeMs: end - 140 * DAY + index * HOUR,
      open: String(price), high: String(price * 1.01), low: String(price * 0.99), close: String(price * 1.0001),
      volume: null, source: 'public' as const, retrievedAtMs: nowMs };
  })).flat();
}
const input = (bars = history(), nowMs = NOW) => ({ bars, nowMs, baseline: [0.2, 0.2, 0.2], behaviorHash: HASH });
describe('causal shadow inference without historical evaluation', () => {
  it('requires exact coverage per asset rather than aggregate count', () => {
    const from = Math.floor(NOW / HOUR) * HOUR - 48 * HOUR, to = from + 48 * HOUR;
    const bars = history().filter((bar) => bar.startTimeMs >= from);
    expect(completeMlWindow(bars, from, to)).toBe(true);
    expect(completeMlWindow(bars.filter((bar) => !(bar.productId === 'LTC-USD' && bar.startTimeMs === from)), from, to)).toBe(false);
    expect(completeMlWindow([...bars.filter((bar) => bar.productId !== 'LTC-USD'), ...bars], from, to)).toBe(true);
  });
  it('produces fresh, bound proposals while withholding qualification and performance evidence', () => {
    const result = inferParallelMlSignal(input());
    expect(result).toMatchObject({ version: ML_INFERENCE_VERSION, gate: 'unqualified', predictedAtMs: Date.parse('2026-10-01T04:00:00Z'), evidence: null });
    expect(result.prediction).toHaveLength(3);
    expect(result.provenance).toMatchObject({ behaviorHash: HASH, trainingRows: 600, trainingCutoffMs: Date.parse('2026-09-28T00:00:00Z') });
  });
  it('does not use future bars or labels after the weekly cutoff', () => {
    const bars = history(), first = inferParallelMlSignal(input(bars));
    const cutoff = first.provenance!.trainingCutoffMs;
    const changed = bars.map((bar) => bar.startTimeMs >= cutoff && bar.startTimeMs < cutoff + DAY ?
      { ...bar, open: '500', high: '510', low: '490', close: '505' } : bar);
    expect(inferParallelMlSignal(input(changed)).modelHash).toBe(first.modelHash);
    const future = { ...bars.at(-1)!, startTimeMs: Math.floor(NOW / HOUR) * HOUR, retrievedAtMs: NOW + HOUR, close: '9999' };
    expect(inferParallelMlSignal(input([...bars, future]))).toEqual(first);
  });
  it('keeps a model stable within a UTC week and refreshes at the next weekly boundary', () => {
    const first = inferParallelMlSignal(input());
    expect(inferParallelMlSignal(input(history(NOW + DAY), NOW + DAY)).modelHash).toBe(first.modelHash);
    const next = inferParallelMlSignal(input(history(NOW + 7 * DAY), NOW + 7 * DAY));
    expect(next.provenance!.trainingCutoffMs).toBe(first.provenance!.trainingCutoffMs + 7 * DAY);
    expect(next.modelHash).not.toBe(first.modelHash);
    expect(next.prediction).toHaveLength(3);
    expect(inferParallelMlSignal(input(history(), NOW + 7 * DAY)).prediction).toBeNull();
  });
  it('rejects a missing current feature bar, inadequate training, and protected label periods', () => {
    const bars = history();
    expect(inferParallelMlSignal(input(bars.filter((bar) => bar.startTimeMs !== Date.parse('2026-09-30T20:00:00Z'))))).toMatchObject({ prediction: null, reason: 'current_feature_window_incomplete' });
    expect(inferParallelMlSignal(input(bars.slice(-48 * 3)))).toMatchObject({ prediction: null });
    expect(inferParallelMlSignal({ ...input(bars), protectedPeriods: [{ startMs: NOW - 140 * DAY, endMs: NOW }] })).toMatchObject({ prediction: null, reason: 'training_coverage_incomplete' });
    expect(inferParallelMlSignal(input(bars, Date.parse('2026-10-01T04:15:00Z')))).toMatchObject({ prediction: null, reason: 'outside_shadow_window' });
  });
  it('projects missing proposals as unavailable and separates a later shadow record from the operational event', () => {
    const event = (kind: string, at: number, prediction: unknown): ParallelPaperEvent => ({ id: kind, kind, at,
      experimentId: 'e', profileId: 'main', detail: { slot: '2026-10-01T04', applied: false, reason: 'shadow',
        prediction, predictedAtMs: prediction ? NOW : null, baselineWeights: {}, proposedWeights: {}, combinedWeights: {} } });
    expect(projectParallelMlStatus([event('ml_target', NOW, null)], null).lastProposed).toEqual([]);
    const result = projectParallelMlStatus([event('ml_target', NOW, null), event('ml_shadow_proposal', NOW + 1, [0, 0, 0])], inferParallelMlSignal(input()));
    expect(result.lastProposed).toHaveLength(3);
    expect(result.evidenceStatus).toBe('unavailable'); expect(result.uncertaintyStatus).toBe('unavailable');
  });
});
