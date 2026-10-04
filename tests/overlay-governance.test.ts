import { describe, it, expect } from 'vitest';
import { overlayHash, overlayCandidates, overlayPlanHash, combinatoriallySymmetricCrossValidation, simultaneousOverlayOptions,
  overlayComparisonCount, evaluateOverlayFinal, type OverlayDevelopment, type CanonicalJsonValue } from '../packages/core/src/index.js';
import { openDatabase, appendIntegrityEvent, listIntegrityEvents, loadTrialRegistry } from '../packages/storage/src/index.js';
import { registerOverlayStudy, runOverlayDevelopment, runOverlayFinal } from '../packages/services/src/index.js';
import { overlayFixturePlan, overlayDataset, OVERLAY_START, OVERLAY_DAY } from './overlay-fixtures.js';
const identity = { codeRevision: 'fixture', sourceManifestHash: 'a'.repeat(64), lockfileHash: 'b'.repeat(64) };
describe('overlay governance', () => {
  it('reserves every diagnostic and selectable candidate before failure, retaining cumulative trials', () => {
    const db = openDatabase(':memory:'); try {
      const p = overlayFixturePlan(), hash = registerOverlayStudy(p, db);
      expect(() => runOverlayDevelopment(hash, overlayDataset(199), identity, OVERLAY_START + 201 * OVERLAY_DAY, db)).toThrow();
      expect(listIntegrityEvents(hash, 'overlay_attempt', db)).toHaveLength(1);
      expect(listIntegrityEvents(hash, 'overlay_failure', db)).toHaveLength(1);
      expect(loadTrialRegistry(db).records.at(-1)?.trialCount).toBe(overlayCandidates().length);
      expect(() => runOverlayDevelopment(hash, overlayDataset(), identity, OVERLAY_START + 201 * OVERLAY_DAY, db)).toThrow('reserved');
    } finally { db.close(); }
  });
  it('joint concurrent final requests claim before data access and interrupted claims cannot reopen', async () => {
    const db = openDatabase(':memory:'); try {
      const plan = overlayFixturePlan(), hash = registerOverlayStudy(plan, db), id = overlayCandidates()[0]!.id;
      const development: OverlayDevelopment = { planHash: hash, datasetHash: plan.developmentDatasetHash, holdout: 'not_loaded', scores: [], foldScores: [],
        folds: [], selected: [id], simpleControls: {}, pbo: combinatoriallySymmetricCrossValidation([], 4) };
      appendIntegrityEvent({ namespace: hash, kind: 'overlay_development', key: 'once', atMs: OVERLAY_START + 201 * OVERLAY_DAY, body: development as unknown as CanonicalJsonValue }, db);
      appendIntegrityEvent({ namespace: hash, kind: 'overlay_freeze', key: 'once', atMs: OVERLAY_START + 202 * OVERLAY_DAY,
        body: { planHash: hash, developmentHash: overlayHash(development), selected: [id], artifacts: {}, simpleControls: {}, comparisonCount: overlayComparisonCount([id]) } }, db);
      let loads = 0;
      const loader = async () => { loads++; expect(listIntegrityEvents(hash, 'final_claim', db)).toHaveLength(1); throw new Error('simulated crash'); };
      const results = await Promise.allSettled([runOverlayFinal(hash, identity, plan.validation.holdout.endExclusiveMs, loader, db),
        runOverlayFinal(hash, identity, plan.validation.holdout.endExclusiveMs, loader, db)]);
      expect(results.every((r) => r.status === 'rejected')).toBe(true); expect(loads).toBe(1);
      expect(listIntegrityEvents(hash, 'overlay_failure', db)).toHaveLength(1);
    } finally { db.close(); }
  });
  it('freezes sufficient adjusted bootstrap tails and horizon plus publication-lag blocks', () => {
    const plan = overlayFixturePlan(), count = overlayComparisonCount(overlayCandidates().filter((c) => !c.diagnosticOnly).slice(0, 20).map((c) => c.id));
    const opts = simultaneousOverlayOptions(plan, count, 14);
    expect(opts.meanBlockLength).toBeGreaterThanOrEqual(16);
    expect(opts.resamples * ((1 - opts.confidenceLevel) / 2)).toBeGreaterThanOrEqual(19.999);
    expect(() => overlayPlanHash({ ...plan, parameterSpace: { future: [1] } })).toThrow();
  });
});


describe('synthetic final overlay evaluation', () => {
  it('retains permanent controls and refuses qualification without account costs or enough eligible actions', () => {
    const db = openDatabase(':memory:'); try {
      const plan = overlayFixturePlan(), hash = overlayPlanHash(plan);
      const candidate = overlayCandidates().find((c) => c.cadence === 14 && c.gate === 'trend' && c.model === 'none')!;
      const development: OverlayDevelopment = { planHash: hash, datasetHash: plan.developmentDatasetHash, holdout: 'not_loaded', scores: [], foldScores: [],
        folds: [], selected: [candidate.id], simpleControls: {}, pbo: combinatoriallySymmetricCrossValidation([], 4) };
      const frozen = { planHash: hash, developmentHash: overlayHash(development), selected: development.selected,
        simpleControls: {}, artifacts: {}, comparisonCount: overlayComparisonCount(development.selected) };
      const result = evaluateOverlayFinal(plan, development, frozen, overlayDataset(600), loadTrialRegistry(db));
      expect(result.accountEvidenceAvailable).toBe(false); expect(result.adopted).toEqual([]); expect(result.activation).toBe('none');
      expect(result.reports.every((r) => r.controls.cash.costs.totalCostUsd === 0 && r.controls.hold.metrics !== null && r.controls.passive.metrics !== null)).toBe(true);
      expect(result.reports.every((r) => r.policies[0]!.costBearingEligibleActions < 30 && !r.policies[0]!.enough)).toBe(true);
      expect(result.universeAssumption).toBe('conditional_fixed_universe');
    } finally { db.close(); }
  }, 60000);
});
