import { describe, expect, it } from 'vitest';
import { overlayCandidates, overlayPlanHash, replayOverlay, ruleParticipation, DEFAULT_TRADE_COST_CONFIG,
  overlayRows, maturedRows, traceActionOutcome } from '../packages/core/src/index.js';
import { overlayDataset, overlayFixturePlan, OVERLAY_START, OVERLAY_DAY } from './overlay-fixtures.js';
describe('registered overlay replay', () => {
  it('enumerates all arms, abstentions, models and diagnostics with immutable identities', () => {
    const candidates = overlayCandidates(); expect(new Set(candidates.map((c) => c.id)).size).toBe(candidates.length);
    expect(candidates.some((c) => c.diagnosticOnly && c.maxDeviation === 0.025)).toBe(true);
    expect(() => overlayPlanHash({ ...overlayFixturePlan(), candidateCount: 1 })).toThrow();
    expect(() => overlayPlanHash({ ...overlayFixturePlan(), taxDragPct: 1 as 0 })).toThrow();
  });
  it('rejects missing rule inputs and measures the standalone trend rejection', () => {
    const trend = overlayCandidates().find((c) => c.gate === 'trend' && !c.tilt)!;
    expect(ruleParticipation(trend, [], 40).permitted).toBe(false);
    expect(ruleParticipation(trend, Array.from({ length: 100 }, (_, i) => 200 - i), 40).reason).toBe('below_trend');
  });
  it('future scrambling and appending cannot change prior targets, orders or books', () => {
    const plan = overlayFixturePlan(), candidate = overlayCandidates()[0]!;
    const run = (count: number, scramble = Infinity) => replayOverlay(overlayDataset(count, scramble), plan, candidate,
      { startIndex: 130, costs: DEFAULT_TRADE_COST_CONFIG });
    const original = run(200); expect(run(220).traces.slice(0, 70)).toEqual(original.traces);
    expect(run(200, 180).traces.slice(0, 50)).toEqual(original.traces.slice(0, 50));
    expect(original.equity[0]!.value).toBe(10000);
    expect(original.costs.totalCostUsd).toBeGreaterThan(0);
  });
  it('skip retains holdings whereas cash exit explicitly sells them', () => {
    const plan = overlayFixturePlan(), book = { cash: '9000', units: new Map([[plan.execution.baseTargets[0]!.assetId as never, '10']]) };
    const reject = overlayCandidates().find((c) => c.gate === 'volatility' && c.cadence === 1 && !c.tilt)!;
    const options = { startIndex: 130, endExclusiveIndex: 131, initialBook: book, costs: DEFAULT_TRADE_COST_CONFIG };
    // A test-only gate threshold forces rejection; it cannot enter a registered candidate grid.
    const skipped = replayOverlay(overlayDataset(), plan, { ...reject, volatilityMultiple: 0 }, options);
    const exited = replayOverlay(overlayDataset(), plan, { ...reject, volatilityMultiple: 0, abstention: 'cash_exit' }, options);
    expect(skipped.traces[0]!.fills).toHaveLength(0);
    expect(skipped.traces[0]!.book.units.get(plan.execution.baseTargets[0]!.assetId as never)).toBe('10');
    expect(exited.traces[0]!.fills.some((f) => f.side === 'sell')).toBe(true);
  });
  it('fixed anchors survive scored fold offsets and unavailable models fall back', () => {
    const plan = overlayFixturePlan(), candidate = overlayCandidates().find((c) => c.cadence === 14 && c.model === 'ridge' && !c.tilt)!;
    const result = replayOverlay(overlayDataset(), plan, candidate, { startIndex: 131, costs: DEFAULT_TRADE_COST_CONFIG });
    expect(result.traces.filter((t) => t.scheduled).every((t) => (t.frame.executionAtMs - plan.arms[1]!.anchorMs) % (14 * OVERLAY_DAY) === 0)).toBe(true);
    expect(result.coverage.fallback).toBeGreaterThan(0);
  });
  it('purges unavailable and overlapping outcomes before the next partition', () => {
    const rows = overlayRows(overlayDataset(), overlayFixturePlan().arms[0]!);
    const boundary = OVERLAY_START + 160 * OVERLAY_DAY;
    expect(maturedRows(rows, OVERLAY_START, boundary).every((r) => r.labelAvailableAtMs < boundary && r.labelEndMs < boundary)).toBe(true);
  });
});


describe('no-overlay compatibility', () => {
  it('missing models retain exactly the ungated book and common risk/accounting semantics', () => {
    const plan = overlayFixturePlan(), dataset = overlayDataset();
    for (const cadence of [1, 14]) {
      const baseline = overlayCandidates().find((c) => c.cadence === cadence && c.model === 'none' && c.gate === 'none')!;
      const challenger = overlayCandidates().find((c) => c.cadence === cadence && c.model === 'tree' && c.gate === 'ml' && c.tilt)!;
      const options = { startIndex: 130, costs: DEFAULT_TRADE_COST_CONFIG };
      const a = replayOverlay(dataset, plan, baseline, options), b = replayOverlay(dataset, plan, challenger, options);
      expect(b.equity).toEqual(a.equity); expect(b.componentCosts).toEqual(a.componentCosts);
      expect(b.traces.map((t) => [t.targets, t.fills, t.book])).toEqual(a.traces.map((t) => [t.targets, t.fills, t.book]));
      expect(b.coverage.fallback).toBeGreaterThan(0);
    }
  });
});

describe('execution liquidity boundaries', () => {
  it('disables an accepted tilt if the attainable open would breach its frozen volume cap', async () => {
    const { buildDecisionMarketDataset, overlayHash, OVERLAY_VERSION, FEATURE_VERSION, OVERLAY_RISK_HASH } = await import('../packages/core/src/index.js');
    const plan = overlayFixturePlan(), source = overlayDataset();
    const make = (gap: number) => buildDecisionMarketDataset(Object.fromEntries(source.assets.map((asset) => [asset, source.barsById[asset]!.map((bar, i) => {
      const price = (100 + i * 0.1) * (i === 130 ? gap : 1); return { ...bar, open: price, high: price + 1, low: price - 1, close: price };
    })])), source.assets, { policy: 'reject-on-gap', nowMs: source.generatedAtMs });
    const candidate = overlayCandidates().find((c) => c.cadence === 1 && c.model === 'ridge' && c.tilt && c.gate === 'none' && !c.diagnosticOnly)!;
    const liquidity = source.assets.map((assetId) => ({ assetId, usdVolume: '2000000', volumeUnit: 'USD' as const, sourceHash: 'a'.repeat(64),
      observedThroughMs: OVERLAY_START + 129 * OVERLAY_DAY, availableAtMs: OVERLAY_START + 129 * OVERLAY_DAY + 300000 }));
    // A deterministic probe model exercises the envelope; it is not qualification evidence.
    const artifact = { version: OVERLAY_VERSION, candidateId: candidate.id, model: { kind: 'ridge' as const, version: OVERLAY_VERSION, parameter: 1,
      means: source.assets.map(() => [0, 0, 0, 0, 0]), scales: source.assets.map(() => [1, 1, 1, 1, 1]),
      coefficients: [0.4, -0.4, 0].map((value) => [value, 0, 0, 0, 0, 0]), trees: [], trainedThroughMs: OVERLAY_START + OVERLAY_DAY },
      participation: null, tilt: { intercept: 20, slope: 0, observations: 60 },
      trainingWindow: { startMs: OVERLAY_START, endExclusiveMs: OVERLAY_START + 2 * OVERLAY_DAY },
      calibrationWindow: { startMs: OVERLAY_START + 2 * OVERLAY_DAY, endExclusiveMs: OVERLAY_START + 128 * OVERLAY_DAY },
      features: FEATURE_VERSION, label: 'attainable-open-horizon-gross-return' as const, cadence: 1 as const, assets: source.assets,
      planHash: overlayPlanHash(plan), datasetHash: source.report.datasetHash, costHash: overlayHash(DEFAULT_TRADE_COST_CONFIG), riskHash: OVERLAY_RISK_HASH,
      sourceManifestHash: plan.sourceManifestHash, lockfileHash: plan.lockfileHash, seed: plan.validation.bootstrapSeed,
      evaluationResultHash: null, liquidityHash: overlayHash(liquidity), updatePolicy: 'explicit' as const, futureRefitContract: 'registered-schedule-separate-qualification' as const };
    const options = { startIndex: 130, endExclusiveIndex: 131, costs: DEFAULT_TRADE_COST_CONFIG, artifact, liquidity,
      initialBook: { cash: '4000', units: new Map(source.assets.map((asset) => [asset, '20'])) } };
    const normal = replayOverlay(make(1), plan, candidate, options), gap = replayOverlay(make(10), plan, candidate, options);
    expect(normal.traces[0]!.reason).toContain('bounded_tilt');
    expect(gap.traces[0]!.reason).toBe('liquidity_execution_baseline_fallback');
    expect(gap.coverage.fallback).toBe(1);
  });
});


describe('publication-bounded validation outcomes', () => {
  it('does not score a label whose ending open publication falls outside the validation window', () => {
    const dataset = overlayDataset(), plan = overlayFixturePlan(), baseline = overlayCandidates()[0]!;
    const run = replayOverlay(dataset, plan, baseline, { startIndex: 195, costs: DEFAULT_TRADE_COST_CONFIG });
    expect(traceActionOutcome(dataset, run.traces[0]!, 1, DEFAULT_TRADE_COST_CONFIG, 0)).not.toBeNull();
    expect(traceActionOutcome(dataset, run.traces.at(-2)!, 1, DEFAULT_TRADE_COST_CONFIG, 0)).toBeNull();
  });
});
