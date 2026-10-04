import { describe, expect, it } from 'vitest';
import { overlayCandidates, trainOverlayModel, predictOverlayModel, fitOverlayCalibration, calibratedProbability,
  calibrationDiagnostics, counterfactualNetPct, boundedTilt, DEFAULT_TRADE_COST_CONFIG, type OverlayRow } from '../packages/core/src/index.js';
import { OVERLAY_ASSETS, OVERLAY_START, OVERLAY_DAY } from './overlay-fixtures.js';
function rows(): OverlayRow[] { return Array.from({ length: 120 }, (_, i) => ({ decisionAtMs: i * 10,
  executionAtMs: i * 10 + 1, labelEndMs: i * 10 + 2, labelAvailableAtMs: i * 10 + 3,
  features: [[Math.sin(i), Math.cos(i), i / 120, 0.2, 0]], forwardReturns: [Math.sin(i) * 0.01] })); }
describe('causal deterministic daily models', () => {
  it('fits ridge and a shallow tree without relaxing legacy data rules', () => {
    for (const kind of ['ridge', 'tree'] as const) {
      const candidate = overlayCandidates().find((c) => c.model === kind)!;
      const first = trainOverlayModel(rows(), candidate, 1300), second = trainOverlayModel(rows(), candidate, 1300);
      expect(first).toEqual(second); expect(predictOverlayModel(first, [[0.2, 0.3, 0.1, 0.2, 0]])[0]).toBeTypeOf('number');
      expect(() => trainOverlayModel(rows(), candidate, 1100)).toThrow('noncausal');
      expect(() => trainOverlayModel(rows().slice(0, 119), candidate, 1300)).toThrow();
    }
  });
  it('calibrates only enough two-class data and reports uncertainty-capable diagnostics', () => {
    const scores = Array.from({ length: 100 }, (_, i) => (i - 50) / 20), labels = scores.map((x, i) => x + Math.sin(i) > 0);
    const fitted = fitOverlayCalibration(scores, labels)!;
    expect(fitted).not.toBeNull(); expect(calibratedProbability(fitted, 2)).toBeGreaterThan(calibratedProbability(fitted, -2));
    expect(fitOverlayCalibration(scores, scores.map(() => true))).toBeNull();
    const metrics = calibrationDiagnostics(scores.map((x) => calibratedProbability(fitted, x)), labels)!;
    expect(metrics.brier).toBeLessThan(0.25); expect(metrics.buckets.reduce((s, b) => s + b.count, 0)).toBe(100);
  });
  it('enforces liquidity, fixed assets, preserved exposure and bounded deviations', () => {
    const assets = OVERLAY_ASSETS.slice(0, 2), baseline = new Map(assets.map((a) => [a, 0.3]));
    const histories = new Map(assets.map((a) => [a, Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) + i)]));
    const candidate = overlayCandidates().find((c) => c.model === 'ridge' && c.tilt)!;
    const input = { book: { cash: '4000', units: new Map(assets.map((a) => [a, '30'])) }, prices: new Map(assets.map((a) => [a, 100])), baseline,
      histories, prediction: [0.4, -0.4], assets, candidate, costs: DEFAULT_TRADE_COST_CONFIG,
      observedThroughMs: OVERLAY_START + OVERLAY_DAY - 100, liquidity: [], decisionAtMs: OVERLAY_START + OVERLAY_DAY };
    expect(boundedTilt(input).reason).toBe('liquidity_unavailable');
    const result = boundedTilt({ ...input, liquidity: assets.map((assetId) => ({ assetId, usdVolume: '1000000000',
      sourceHash: 'a'.repeat(64), volumeUnit: 'USD' as const, observedThroughMs: input.decisionAtMs - 100,
      availableAtMs: input.decisionAtMs })) });
    expect(result.changed).toBe(true);
    expect([...result.weights.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(0.6, 12);
    expect([...result.weights].every(([asset, weight]) => baseline.has(asset) && Math.abs(weight - baseline.get(asset)!) <= 0.05 + 1e-12)).toBe(true);
    expect(boundedTilt({ ...input, prediction: [0, 0] }).changed).toBe(false);
  });
});


describe('risk-aware cloned action books', () => {
  it('includes intermediate hard-stop exits and their costs rather than only endpoint prices', () => {
    const asset = OVERLAY_ASSETS[0]!, prices = new Map([[asset, 100]]), ending = new Map([[asset, 110]]);
    const input = { book: { cash: '10000', units: new Map() }, weights: new Map([[asset, 0.3]]), prices,
      endingPrices: ending, costs: DEFAULT_TRADE_COST_CONFIG, horizonDays: 2, cashAprPct: 0 };
    const held = counterfactualNetPct(input);
    const stopped = counterfactualNetPct({ ...input, risk: { peak: 10000, priorObserved: 10000, stopped: false },
      path: [{ observedPrices: new Map([[asset, 80]]), executionPrices: new Map([[asset, 80]]) },
        { observedPrices: ending, executionPrices: ending }] });
    expect(held).toBeGreaterThan(0); expect(stopped).toBeLessThan(0);
  });
});
