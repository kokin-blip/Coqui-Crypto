import { describe, it, expect } from 'vitest';
import { evaluateOverlayDevelopment, freezeOverlayArtifacts, overlayCandidates, fitOverlayArtifact, validateOverlayModel,
  predictOverlayModel, trainOverlayModel, type OverlayRow } from '../packages/core/src/index.js';
import { overlayDataset, overlayFixturePlan, OVERLAY_START, OVERLAY_DAY } from './overlay-fixtures.js';
describe('chronological overlay development', () => {
  it('reports every treatment and scenario without loading a holdout; insufficient ML cannot earn selection', () => {
    const dataset = overlayDataset(270), plan = overlayFixturePlan(270), result = evaluateOverlayDevelopment(plan, dataset);
    expect(result.holdout).toBe('not_loaded');
    expect(result.scores).toHaveLength(overlayCandidates().length * plan.scenarios.length);
    expect(result.folds.every((fold) => fold.trainingEndMs < fold.validationStartMs && fold.selected.length === 0)).toBe(true);
    expect(result.scores.filter((s) => s.candidate.model !== 'none').every((s) => s.predictions === 0 && s.fallbacks > 0)).toBe(true);
    expect(result.selected.every((id) => overlayCandidates().find((c) => c.id === id)!.model === 'none')).toBe(true);
    const frozen = freezeOverlayArtifacts(plan, result, dataset);
    expect(frozen.developmentHash).toHaveLength(64);
    expect(() => evaluateOverlayDevelopment(plan, overlayDataset(271))).toThrow('development_only');
  }, 60000);
  it('sparse fourteen-day training is disabled rather than lowering minimums', () => {
    const dataset = overlayDataset(400), plan = overlayFixturePlan(400), candidate = overlayCandidates().find((c) => c.cadence === 14 && c.model === 'ridge')!;
    expect(fitOverlayArtifact(dataset, plan, candidate, plan.scenarios[1]!.config, OVERLAY_START + 400 * OVERLAY_DAY)).toBeNull();
  });
  it('rejects corrupt normalization and trees instead of accepting a probe prediction', () => {
    const rows: OverlayRow[] = Array.from({ length: 120 }, (_, i) => ({ decisionAtMs: i * 10, executionAtMs: i * 10 + 1,
      labelEndMs: i * 10 + 2, labelAvailableAtMs: i * 10 + 3, features: [[i, i % 3, Math.sin(i), 0, 0]], forwardReturns: [Math.sin(i) * 0.01] }));
    const model = trainOverlayModel(rows, overlayCandidates().find((c) => c.model === 'ridge')!, 1300);
    expect(() => predictOverlayModel({ ...model, scales: [[0, 1, 1, 1, 1]] }, [[0, 0, 0, 0, 0]])).toThrow('invalid');
    const tree = trainOverlayModel(rows, overlayCandidates().find((c) => c.model === 'tree')!, 1300);
    expect(() => validateOverlayModel({ ...tree, trees: [{ value: 0, feature: 9, split: 0, left: { value: 1 }, right: { value: 1 } }] })).toThrow();
  });
});

describe('reproducible model artifacts', () => {
  it('uses disjoint training/calibration windows and future perturbations cannot alter fitted parameters', () => {
    const dataset = overlayDataset(500), plan = overlayFixturePlan(500), candidate = overlayCandidates().find((c) => c.cadence === 1 && c.model === 'ridge')!;
    const boundary = OVERLAY_START + 450 * OVERLAY_DAY;
    const a = fitOverlayArtifact(dataset, plan, candidate, plan.scenarios[1]!.config, boundary)!;
    const b = fitOverlayArtifact(overlayDataset(500, 460), plan, candidate, plan.scenarios[1]!.config, boundary)!;
    expect(a).not.toBeNull(); expect(a.model).toEqual(b.model); expect(a.participation).toEqual(b.participation);
    expect(a.model.trainedThroughMs).toBeLessThan(a.calibrationWindow.startMs);
    expect(a.trainingWindow.endExclusiveMs).toBeLessThanOrEqual(a.calibrationWindow.startMs);
    expect(a.calibrationWindow.endExclusiveMs).toBe(boundary);
    expect(a.updatePolicy).toBe('explicit'); expect(a.futureRefitContract).toBe('registered-schedule-separate-qualification');
  }, 20000);
});
