import { describe, expect, it } from 'vitest';
import { buildDecisionMarketDataset, instrumentKey, coinbaseResearchScenarios, integrityPlanHash,
  INTEGRITY_ENGINE_VERSION, INTEGRITY_ADOPTION_DEFAULTS, familyCandidates, runFamilyCandidate, evaluateIntegrityDevelopment,
  costScenarioHash, estimateTradeCost, compatibleProfitabilityLowerBound, evaluateStrategyHealth,
  OBSERVATION_HEALTH_POLICY, type IntegrityStudyPlan, type MarketBar, type CanonicalJsonValue,
  type StrategyHealthInput } from '../packages/core/src/index.js';
import { openDatabase, listIntegrityEvents, claimIntegrityHoldout, appendIntegrityEvent,
  loadTrialRegistry } from '../packages/storage/src/index.js';
import { registerIntegrityStudy, runIntegrityDevelopment, freezeIntegrityCandidate, runIntegrityFinal,
  readIntegrityWorkspace, recordMonthlyStrategyHealth, readStrategyHealth } from '../packages/services/src/index.js';
import { paperGrossEdgeLowerBoundPct } from '../apps/desktop/src/main/forward-edge-runtime.js';
const DAY = 86_400_000, START = Date.UTC(2024, 0, 1);
const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
function dataset(count = 90) {
  const bars: MarketBar[] = Array.from({ length: count }, (_, index) => {
    const close = 100 + index + Math.sin(index) * 2;
    return { assetId: BTC, source: 'coinbase', interval: '1d', startTimeMs: START + index * DAY,
      endTimeMs: START + (index + 1) * DAY, open: close, close, high: close + 1, low: close - 1,
      volume: 100, isComplete: true, retrievedAtMs: START + 90 * DAY, quality: 'reported_ohlc' };
  });
  return buildDecisionMarketDataset({ [BTC]: bars }, [BTC], { policy: 'reject-on-gap', nowMs: START + (count + 1) * DAY });
}
function plan(family: IntegrityStudyPlan['family'] = 'momentum'): IntegrityStudyPlan {
  return { schemaVersion: 2, id: `fixture-${family}`, registeredAt: new Date(START).toISOString(), family,
    hypothesis: 'Synthetic mechanics only', parameterSpace: { lookbackDays: [3, 4], rebalanceEveryDays: [7] },
    candidateCount: 2, developmentDatasetHash: dataset().report.datasetHash, dataLineage: 'coinbase-daily-test',
    sourceManifestHash: 'a'.repeat(64), lockfileHash: 'b'.repeat(64), codeRevision: 'fixture',
    engineVersion: INTEGRITY_ENGINE_VERSION, benchmarkRebalanceEveryDays: 14,
    scenarios: coinbaseResearchScenarios(), universe: { kind: 'conditional_fixed_universe', assets: [BTC] },
    execution: { warmupBars: 3, cashAprPct: 0, baseTargets: [{ assetId: BTC, weight: 1 }] },
    validation: { development: { startMs: START, endExclusiveMs: START + 90 * DAY },
      holdout: { startMs: START + 100 * DAY, endExclusiveMs: START + 160 * DAY },
      nestedFoldCount: 3, embargoDays: 2, minimumDevelopmentBars: 90, minimumHoldoutBars: 60,
      cscvPartitionCount: 4, bootstrapResamples: 500, bootstrapMeanBlockLength: 7,
      bootstrapConfidenceLevel: 0.95, bootstrapSeed: 86 },
    primaryMetric: 'after-cost-excess-return-vs-hold', adoptionRules: INTEGRITY_ADOPTION_DEFAULTS,
    studyRef: 'docs/studies/research-integrity.md' };
}
const runtime = { codeRevision: 'fixture', sourceManifestHash: 'a'.repeat(64), lockfileHash: 'b'.repeat(64) };
const devAt = START + 91 * DAY, freezeAt = START + 92 * DAY, finalAt = START + 161 * DAY;
describe('read-only governed workspace',()=>{
  it('shows none and consumed exposure without loading final-performance bodies',()=>{
    const db=openDatabase(':memory:'),hash=registerIntegrityStudy(plan(),db);
    expect(readIntegrityWorkspace(db)[0]).toMatchObject({candidateState:'not_frozen',holdoutState:'no_claim_in_this_namespace',prospectiveEnrollment:'not_verified'});
    const developmentHash=appendIntegrityEvent({namespace:hash,kind:'development_result',key:'fixture',atMs:devAt,body:{fixture:true}},db);
    appendIntegrityEvent({namespace:hash,kind:'freeze',key:'fixture',atMs:freezeAt,body:{candidateId:null,developmentHash}},db);
    appendIntegrityEvent({namespace:hash,kind:'final_claim',key:'fixture',atMs:finalAt,body:{fixture:true}},db);
    // Malformed sealed payload is intentionally never read by this metadata projection.
    db.prepare('INSERT INTO research_integrity_events(namespace,kind,record_key,at_ms,body_json,content_hash) VALUES(?,?,?,?,?,?)').run(hash,'final_result','fixture',finalAt,'{"sealed":"do not load"}','0'.repeat(64));
    expect(readIntegrityWorkspace(db)[0]).toMatchObject({candidateState:'none',candidateId:null,holdoutState:'consumed'});
    db.close();
  });
});
describe('versioned cost and family contracts', () => {
  it('registers exactly two spread-floor candidates and rejects invalid values', () => {
    const baseline = plan('trendvol');
    const proposed = { ...baseline, parameterSpace: { lookbackDays: [3], relativeScoreSpreadFloor: [0, 0.25] } };
    const candidates = familyCandidates(proposed);
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(2);
    for (const value of [-1, NaN, Infinity, '0.25']) {
      expect(() => familyCandidates({ ...proposed, candidateCount: 1,
        parameterSpace: { relativeScoreSpreadFloor: [value] } })).toThrow();
    }
    expect(() => familyCandidates({ ...proposed, candidateCount: 3 })).toThrow('count');
    const db = openDatabase(':memory:');
    try {
      const hash = registerIntegrityStudy(proposed, db);
      runIntegrityDevelopment(hash, dataset(), runtime, devAt, db);
      const registry = loadTrialRegistry(db);
      expect(registry.records).toHaveLength(1);
      expect(registry.records[0]!.trialCount).toBe(2);
      expect(registry.records[0]!.parameterSpace['relativeScoreSpreadFloor']).toEqual([0, 0.25]);
      expect(listIntegrityEvents(hash, 'development_attempt', db)[0]!.body).toEqual({ candidateCount: 2 });
    } finally { db.close(); }
  }, 30000);
  it('passes the spread floor through the research runner into target decisions', () => {
    const eth = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });
    const original = dataset();
    const series = [BTC, eth].map((assetId, assetIndex) => original.barsById[BTC]!.map((bar, index) => {
      const close = 100 * Math.exp((0.0001 + assetIndex * 1e-8) * index + 0.001 * Math.sin(index));
      return { ...bar, assetId, open: close, high: close + 1, low: close - 1, close };
    }));
    const input = buildDecisionMarketDataset({ [BTC]: series[0]!, [eth]: series[1]! }, [BTC, eth],
      { policy: 'reject-on-gap', nowMs: original.generatedAtMs });
    const proposed = { ...plan('trendvol'), execution: { warmupBars: 31, cashAprPct: 0,
      baseTargets: [{ assetId: BTC, weight: 0.5 }, { assetId: eth, weight: 0.5 }] },
      parameterSpace: { lookbackDays: [10], trendGateDays: [10], relativeScoreSpreadFloor: [0, 0.25] } };
    const candidates = familyCandidates(proposed);
    const scenario = coinbaseResearchScenarios().find((s) => s.scenario === 'conservative')!;
    const runs = candidates.map((candidate) => runFamilyCandidate(input, 31, proposed, candidate, scenario));
    expect(runs[0]!.trendvol.equity).not.toEqual(runs[1]!.trendvol.equity);
    const omitted = { id: 'legacy', parameters: { lookbackDays: 10, trendGateDays: 10 } };
    expect(runFamilyCandidate(input, 31, proposed, omitted, scenario)).toEqual(runs[0]);
  });
  it('keeps account evidence unavailable, preserves old cost identity and stresses costs', () => {
    const profiles = coinbaseResearchScenarios();
    expect(profiles.map((p) => p.scenario)).toEqual(['optimistic', 'conservative', 'stress']);
    const costs = profiles.map((p) => estimateTradeCost({ amountUsd: 1000, side: 'buy' }, p.config).totalCostUsd);
    expect(costs[2]).toBeGreaterThan(costs[1]!);
    expect(profiles[1]!.takerFeeBps).toBe(90);
    expect(() => costScenarioHash({ ...profiles[1]!, liquidityRole: 'maker' })).toThrow();
    expect(() => costScenarioHash({ ...profiles[1]!, scenario: 'account' })).toThrow();
  });
  it('rejects unsupported parameters and weak adoption policies', () => {
    expect(() => familyCandidates({ ...plan(), parameterSpace: { future: [1] }, candidateCount: 1 })).toThrow();
    expect(() => integrityPlanHash({ ...plan(), adoptionRules: { ...INTEGRITY_ADOPTION_DEFAULTS,
      minimumDeflatedSharpeProbability: 0.5 } })).toThrow();
  });
  it('supports all four existing families with chronological embargo and all candidates reported', () => {
    for (const family of ['momentum', 'voltarget', 'trendvol', 'rotation'] as const) {
      const p = plan(family);
      const spec = family === 'voltarget' ? { ...p, parameterSpace: { targetVolPct: [30, 40] } } : p;
      const report = evaluateIntegrityDevelopment(spec, dataset());
      expect(report.candidates).toHaveLength(2);
      expect(report.finalHoldout).toBe('not_loaded');
      expect(report.accountEvidenceAvailable).toBe(false);
      expect(report.folds.every((fold) => fold.validationStartMs - fold.trainingEndExclusiveMs === 2 * DAY)).toBe(true);
      expect(report.candidates.every((candidate) => candidate.scenarios.length === 3)).toBe(true);
    }
  }, 30000);
});
describe('durable holdout governance', () => {
  it('reserves trials before a failed development evaluation and cannot erase the failure', () => {
    const db = openDatabase(':memory:'), p = plan(), hash = registerIntegrityStudy(p, db);
    expect(() => runIntegrityDevelopment(hash, dataset(91), runtime, devAt, db)).toThrow();
    expect(loadTrialRegistry(db).records.find((r) => r.id === `integrity:${hash}`)?.trialCount).toBe(2);
    expect(listIntegrityEvents(hash, 'development_failure', db)).toHaveLength(1);
    expect(() => db.prepare('DELETE FROM research_integrity_events').run()).toThrow('immutable');
    expect(() => runIntegrityDevelopment(hash, dataset(), runtime, devAt, db)).toThrow('reserved');
    db.close();
  });
  it('claims before reading, records failure and prevents renamed plans reopening overlapping data', async () => {
    const db = openDatabase(':memory:'), p = plan(), hash = registerIntegrityStudy(p, db);
    const report = runIntegrityDevelopment(hash, dataset(), runtime, devAt, db);
    freezeIntegrityCandidate(hash, report.selectedCandidate.id, freezeAt, db);
    let loads = 0;
    const load = async () => {
      loads += 1; expect(listIntegrityEvents(hash, 'final_claim', db)).toHaveLength(1);
      throw new Error('simulated interrupted loader');
    };
    await expect(runIntegrityFinal(hash, runtime, finalAt, load, db)).rejects.toThrow('interrupted');
    await expect(runIntegrityFinal(hash, runtime, finalAt, load, db)).rejects.toThrow('consumed');
    expect(loads).toBe(1);
    expect(listIntegrityEvents(hash, 'final_failure', db)).toHaveLength(1);
    expect(() => claimIntegrityHoldout({ planHash: 'renamed', startMs: START + 110 * DAY,
      endExclusiveMs: START + 180 * DAY, assets: [BTC], dataLineage: 'renamed', freezeHash: 'c'.repeat(64), atMs: finalAt }, db)).toThrow('consumed');
    db.close();
  }, 30000);
  it('allows only one concurrent loader and returns completed evidence without reopening data', async () => {
    const db = openDatabase(':memory:'), hash = registerIntegrityStudy(plan(), db);
    const development = runIntegrityDevelopment(hash, dataset(), runtime, devAt, db);
    freezeIntegrityCandidate(hash, development.selectedCandidate.id, freezeAt, db);
    let release!: (value: ReturnType<typeof dataset>) => void;
    let loads = 0;
    const pending = new Promise<ReturnType<typeof dataset>>((resolve) => { release = resolve; });
    const loader = async () => { loads += 1; return pending; };
    const first = runIntegrityFinal(hash, runtime, finalAt, loader, db);
    await expect(runIntegrityFinal(hash, runtime, finalAt, loader, db)).rejects.toThrow('consumed');
    expect(loads).toBe(1);
    release(dataset(160));
    const result = await first;
    expect(result?.adopted).toBe(false);
    expect(result?.limitation).toBe('account_cost_evidence_unavailable');
    expect(await runIntegrityFinal(hash, runtime, finalAt, loader, db)).toEqual(result);
    expect(loads).toBe(1);
    db.close();
  }, 30000);
  it('freezes none without loading a holdout and refuses freezes after it starts', async () => {
    const db = openDatabase(':memory:'), hash = registerIntegrityStudy(plan(), db);
    runIntegrityDevelopment(hash, dataset(), runtime, devAt, db);
    expect(() => freezeIntegrityCandidate(hash, null, START + 101 * DAY, db)).toThrow('before holdout');
    freezeIntegrityCandidate(hash, null, freezeAt, db);
    let loads = 0;
    expect(await runIntegrityFinal(hash, runtime, finalAt, async () => { loads++; return dataset(160); }, db)).toBeNull();
    expect(loads).toBe(0); db.close();
  }, 30000);
});
const healthInput = (): StrategyHealthInput => ({ days: Array.from({ length: 100 }, (_, i) => START + i * DAY),
  netReturns: Array.from({ length: 100 }, (_, i) => -0.002 + Math.sin(i) * 0.0001),
  benchmarkReturns: Array(100).fill(0), missingObservations: 0,
  observedModeledCostUsd: 100, observedActualCostUsd: 200, observedFillCount: 25,
  reconciliationExceptions: 0, hardSafetyStop: false });
describe('bound abstention and persistent health', () => {
  it('cannot substitute a retired shipped strategy study for the current desktop executable', () => {
    const db = openDatabase(':memory:');
    expect(paperGrossEdgeLowerBoundPct('main', db, START)).toBeNull();
    db.close();
  });
  it('rejects wrong units, profiles, cost versions and expired evidence', () => {
    const binding = { profileId: 'alpha', strategyId: 'test', codeRevision: 'fixture', costProfileHash: 'a'.repeat(64),
      horizonMs: DAY, normalization: 'gross_pct_per_turnover' as const, validFromMs: 0, validUntilMs: DAY };
    const evidence = { binding, grossEdgeLowerBoundPct: 3, resultHash: 'b'.repeat(64), sourceHashes: ['c'.repeat(64)], integrityVerified: true as const };
    expect(compatibleProfitabilityLowerBound(evidence, binding, 1)).toBe(3);
    expect(compatibleProfitabilityLowerBound(evidence, { ...binding, horizonMs: 2 * DAY }, 1)).toBeNull();
    expect(compatibleProfitabilityLowerBound({ ...evidence, binding: { ...binding,
      normalization: 'daily_portfolio_excess' as typeof binding.normalization } }, binding, 1)).toBeNull();
    expect(compatibleProfitabilityLowerBound(evidence, { ...binding, profileId: 'beta' }, 1)).toBeNull();
    expect(compatibleProfitabilityLowerBound(evidence, { ...binding, costProfileHash: 'd'.repeat(64) }, 1)).toBeNull();
    expect(compatibleProfitabilityLowerBound(evidence, binding, DAY)).toBeNull();
    expect(compatibleProfitabilityLowerBound({ ...evidence, grossEdgeLowerBoundPct: NaN }, binding, 1)).toBeNull();
  });
  it('observes deterioration without pausing; qualified repeated deterioration and hard stops stay paused', () => {
    const watch = evaluateStrategyHealth(healthInput());
    expect(watch.state).toBe('watch'); expect(watch.canGeneratePaperIntents).toBe(true);
    const policy = { ...OBSERVATION_HEALTH_POLICY, mode: 'qualified' as const };
    const degraded = evaluateStrategyHealth(healthInput(), policy);
    expect(degraded.state).toBe('degraded');
    const paused = evaluateStrategyHealth(healthInput(), policy, degraded);
    expect(paused.state).toBe('paused');
    const improved = { ...healthInput(), netReturns: Array(100).fill(0.003), observedActualCostUsd: 50 };
    expect(evaluateStrategyHealth(improved, policy, paused).state).toBe('paused');
    expect(evaluateStrategyHealth({ ...improved, hardSafetyStop: true }).state).toBe('paused');
  });
  it('persists one review per month and retains a pause across read/restart', () => {
    const db = openDatabase(':memory:');
    const january = START + DAY;
    const paused = recordMonthlyStrategyHealth('alpha', 'test', january, { ...healthInput(), hardSafetyStop: true }, db);
    expect(recordMonthlyStrategyHealth('alpha', 'test', january + DAY, healthInput(), db)).toEqual(paused);
    expect(readStrategyHealth('alpha', 'test', db)?.state).toBe('paused');
    expect(readStrategyHealth('beta', 'test', db)).toBeNull();
    expect(listIntegrityEvents(null, 'health_review', db)).toHaveLength(1);
    appendIntegrityEvent({ namespace: 'unrelated', kind: 'fixture', key: 'one', atMs: 0, body: {} as CanonicalJsonValue }, db);
    db.close();
  });
});
