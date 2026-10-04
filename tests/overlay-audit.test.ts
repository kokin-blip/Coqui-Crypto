import { describe, expect, it } from 'vitest';
import { buildDecisionMarketDataset, decisionFrameAt, decideOverlayShadow, overlayCandidates,
  overlayHash, overlayPlanHash, OVERLAY_VERSION, FEATURE_VERSION, OVERLAY_RISK_HASH,
  replayOverlay, DEFAULT_TRADE_COST_CONFIG, proposeMlTarget, type OverlayArtifact } from '../packages/core/src/index.js';
import { overlayDataset, overlayFixturePlan, OVERLAY_START, OVERLAY_DAY } from './overlay-fixtures.js';

const plan = overlayFixturePlan(), dataset = overlayDataset();
const candidate = overlayCandidates().find((c) => c.cadence === 1 && c.model === 'ridge' && c.gate === 'ml' && !c.tilt)!;
/** Probe coefficients exercise software paths only; they are not fitted investment evidence. */
function artifact(): OverlayArtifact {
  return { version: OVERLAY_VERSION, candidateId: candidate.id,
    model: { kind: 'ridge', version: OVERLAY_VERSION, parameter: candidate.modelParameter,
      means: dataset.assets.map(() => [0, 0, 0, 0, 0]), scales: dataset.assets.map(() => [1, 1, 1, 1, 1]),
      coefficients: dataset.assets.map(() => [0.1, 0, 0, 0, 0, 0]), trees: [],
      trainedThroughMs: OVERLAY_START + OVERLAY_DAY },
    participation: { intercept: 20, slope: 0, observations: 60 }, tilt: null,
    trainingWindow: { startMs: OVERLAY_START, endExclusiveMs: OVERLAY_START + 2 * OVERLAY_DAY },
    calibrationWindow: { startMs: OVERLAY_START + 2 * OVERLAY_DAY, endExclusiveMs: OVERLAY_START + 128 * OVERLAY_DAY },
    features: FEATURE_VERSION, label: 'attainable-open-horizon-gross-return', cadence: 1, assets: dataset.assets,
    planHash: overlayPlanHash(plan), datasetHash: dataset.report.datasetHash,
    costHash: overlayHash(DEFAULT_TRADE_COST_CONFIG), riskHash: OVERLAY_RISK_HASH,
    sourceManifestHash: plan.sourceManifestHash, lockfileHash: plan.lockfileHash, seed: plan.validation.bootstrapSeed,
    evaluationResultHash: null, liquidityHash: overlayHash([]), updatePolicy: 'explicit',
    futureRefitContract: 'registered-schedule-separate-qualification' };
}
const options = { startIndex: 130, endExclusiveIndex: 131, costs: DEFAULT_TRADE_COST_CONFIG };
describe('overlay audit regressions', () => {
  it('rejects a model trained after its stated calibration window even if outer artifact dates look causal', () => {
    const valid = artifact();
    expect(replayOverlay(dataset, plan, candidate, { ...options, artifact: valid }).traces[0]!.prediction).not.toBeNull();
    expect(() => replayOverlay(dataset, plan, candidate, { ...options,
      artifact: { ...valid, model: { ...valid.model, trainedThroughMs: OVERLAY_START + 180 * OVERLAY_DAY } } }))
      .toThrow('overlay_artifact_provenance_invalid');
  });
  it('rejects an artifact built under different source code', () => {
    expect(() => replayOverlay(dataset, plan, candidate, { ...options,
      artifact: { ...artifact(), sourceManifestHash: 'f'.repeat(64) } })).toThrow('overlay_artifact_provenance_invalid');
  });
  it.each([null, 20, -20])('replay and shadow agree for unavailable, accepted, and rejected models (%s)', (intercept) => {
    const model = intercept === null ? null : { ...artifact(), participation: { intercept, slope: 0, observations: 60 } };
    const replay = replayOverlay(dataset, plan, candidate, { ...options, artifact: model }).traces[0]!;
    const frame = decisionFrameAt(dataset, options.startIndex);
    const observed = buildDecisionMarketDataset(Object.fromEntries(dataset.assets.map((asset) =>
      [asset, dataset.barsById[asset]!.slice(0, frame.observedEndExclusive)])), dataset.assets,
    { policy: 'reject-on-gap', nowMs: frame.decisionAtMs });
    const shadow = decideOverlayShadow({ dataset: observed, plan, candidate, artifact: model,
      book: { cash: '10000', units: new Map() }, risk: { peak: 10000, priorObserved: 10000, stopped: false },
      costs: DEFAULT_TRADE_COST_CONFIG, decisionAtMs: frame.decisionAtMs, executionAtMs: frame.executionAtMs });
    expect(shadow.targets).toEqual(replay.targets);
    expect(shadow.prediction).toEqual(replay.prediction);
    expect(shadow.permitted).toBe(replay.permitted);
    expect(shadow.fallback).toBe(replay.fallback);
    expect(shadow.act).toBe(replay.fills.length > 0);
  });
  it('preserves baseline at and below break-even friction, but responds above it', () => {
    const baseline = [0.2, 0.2, 0.2];
    for (const predicted of [0, 0.009, 0.01]) {
      expect(proposeMlTarget(baseline, [predicted, predicted, predicted]).weights).toEqual(baseline);
    }
    const changed = proposeMlTarget(baseline, [0.011, 0.011, 0.011]);
    expect(changed.turnover).toBeGreaterThan(0);
    expect(changed.expectedNetImprovement).toBeGreaterThan(0);
  });
});
