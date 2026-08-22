import { describe, expect, it } from 'vitest';

import {
  gridCandidateCount,
  instrumentKey,
  tradeCostConfigHash,
  DEFAULT_TRADE_COST_CONFIG,
  type ResearchPreRegistration,
} from '../packages/core/src/index.js';
import {
  registerResearchPreRegistration,
  ResearchScoreboardService,
} from '../packages/services/src/index.js';
import {
  openDatabase,
  researchStudyRunHash,
  saveResearchStudyRun,
  type Db,
  type ResearchStudyRunWithoutHash,
} from '../packages/storage/src/index.js';

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2020, 0, 1);
const HOLDOUT_DAYS = 32;
const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
const HASH_B = 'b'.repeat(64);

const PARAMETER_SPACE = {
  lookbackDays: [90, 180],
  volatilityDays: [30],
  maxRelativeTilt: [0.35],
  defensiveScale: [0.2],
  targetVolatilityPct: [55],
  targetVolPct: [50],
  volLookbackDays: [30],
  minExposure: [0.1],
  maxExposure: [1],
  trendGateDays: [100],
  belowTrendMaxExposure: [0.7],
  rebalanceEveryDays: [30],
} as const;

function registerPlan(db: Db): string {
  const plan: ResearchPreRegistration = {
    schemaVersion: 1,
    id: 'scoreboard-plan',
    registeredAt: '2026-08-09T00:00:00.000Z',
    family: 'trendvol',
    hypothesis: 'Trend-vol produces positive excess returns on untouched data.',
    parameterSpace: PARAMETER_SPACE,
    candidateCount: gridCandidateCount(PARAMETER_SPACE),
    datasetHash: HASH_B,
    costProfileHash: tradeCostConfigHash(DEFAULT_TRADE_COST_CONFIG),
    codeRevision: 'scoreboard-revision',
    execution: { baseTargets: [{ assetId: BTC, weight: 1 }], warmupBars: 10, cashAprPct: 0 },
    validation: {
      development: { startMs: START_MS, endExclusiveMs: START_MS + 90 * DAY_MS },
      holdout: {
        startMs: START_MS + 90 * DAY_MS,
        endExclusiveMs: START_MS + (90 + HOLDOUT_DAYS) * DAY_MS,
      },
      nestedFoldCount: 3,
      embargoDays: 2,
      minimumDevelopmentBars: 90,
      minimumHoldoutBars: 30,
      cscvPartitionCount: 4,
      bootstrapResamples: 500,
      bootstrapMeanBlockLength: 5,
      bootstrapConfidenceLevel: 0.95,
      bootstrapSeed: 7,
    },
    primaryMetric: 'after-cost-excess-return-vs-hold',
    adoptionRules: {
      minimumDeflatedSharpeProbability: 0.95,
      requirePositiveExcessReturnVsHold: true,
      requirePositiveExcessReturnVsPassive: true,
      rejectIfSignificanceUnavailable: true,
      maximumDrawdownPct: 35,
      maximumProbabilityOfBacktestOverfitting: 0.05,
    },
    studyRef: 'docs/studies/trendvol-replacement-v1-2026-08-09.md',
  };
  return registerResearchPreRegistration(plan, db);
}

function metrics(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    totalReturnPct: 11.2,
    annualizedReturnPct: 8,
    maxDrawdownPct: -44.1,
    volatilityPct: 30,
    sharpe: 0.3,
    sortino: 0.38,
    calmar: 0.2,
    ...overrides,
  };
}

function resultJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    planId: 'scoreboard-plan',
    datasetHash: HASH_B,
    candidateCount: 2,
    holdout: {
      adopted: false,
      afterCostReturnPct: 18.4,
      excessReturnVsHoldPct: 7.2,
      excessReturnVsPassivePct: 14,
      metrics: metrics({ totalReturnPct: 18.4, maxDrawdownPct: -31.7, sortino: 0.61, sharpe: 0.44 }),
      holdMetrics: metrics(),
      passiveMetrics: metrics({ totalReturnPct: 4.4, maxDrawdownPct: -22.8, sortino: 0.31 }),
      psr: 0.62,
      dsr: 0.41,
      trialCount: 215,
      ...overrides,
    },
  });
}

function saveRun(db: Db, planHash: string, json = resultJson()): void {
  const run: ResearchStudyRunWithoutHash = {
    id: 'trendvol-replacement-v1',
    preRegistrationHash: planHash,
    completedAtMs: 1_723_000_000_000,
    datasetHash: HASH_B,
    costProfileHash: 'c'.repeat(64),
    codeRevision: '037927e',
    selectedCandidateId: 'e'.repeat(64),
    adopted: false,
    resultJson: json,
  };
  saveResearchStudyRun({ ...run, runHash: researchStudyRunHash(run) }, db);
}

function service(db: Db): ResearchScoreboardService {
  return new ResearchScoreboardService({ database: db });
}

describe('ResearchScoreboardService', () => {
  it('renders selected, hold and passive as comparable rows', () => {
    const db = openDatabase(':memory:');
    saveRun(db, registerPlan(db));

    const result = service(db).latest();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.tracks.map((track) => track.trackId)).toEqual([
      'selected',
      'hold',
      'passive',
    ]);
    expect(result.value.tracks[0]).toMatchObject({
      afterCostReturnPct: 18.4,
      maxDrawdownPct: -31.7,
      sortino: 0.61,
    });
    expect(result.value.tracks[1]).toMatchObject({ afterCostReturnPct: 11.2, sortino: 0.38 });
    db.close();
  });

  it('never attributes the candidate DSR or trial count to a benchmark', () => {
    const db = openDatabase(':memory:');
    saveRun(db, registerPlan(db));

    const result = service(db).latest();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [selected, hold, passive] = result.value.tracks;
    expect(selected).toMatchObject({ dsr: 0.41, trialCount: 215 });
    // A benchmark was never a candidate, so it has no search budget to deflate.
    // Borrowing the candidate's DSR would claim significance never tested for.
    expect(hold).toMatchObject({ dsr: null, trialCount: null });
    expect(passive).toMatchObject({ dsr: null, trialCount: null });
    db.close();
  });

  it('reports excess return only for the candidate', () => {
    const db = openDatabase(':memory:');
    saveRun(db, registerPlan(db));
    const result = service(db).latest();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tracks[0]?.excessReturnVsHoldPct).toBe(7.2);
    // "Hold's excess return versus hold" is not a quantity.
    expect(result.value.tracks[1]?.excessReturnVsHoldPct).toBeNull();
    db.close();
  });

  it('states that parameters are unvalidated as a literal, not a computation', () => {
    const db = openDatabase(':memory:');
    saveRun(db, registerPlan(db));
    const result = service(db).latest();
    expect(result.ok && result.value.parametersValidated).toBe(false);
    db.close();
  });
});

describe('ResearchScoreboardService sample length', () => {
  it('reads the holdout window from the registered plan', () => {
    const db = openDatabase(':memory:');
    saveRun(db, registerPlan(db));
    const result = service(db).latest();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Not derived from an equity series — none is persisted.
    expect(result.value.sampleDays).toBe(HOLDOUT_DAYS);
    db.close();
  });
});

describe('ResearchScoreboardService failure modes', () => {
  it('reports an empty registry distinctly from a broken one', () => {
    const db = openDatabase(':memory:');
    expect(service(db).latest()).toEqual({
      ok: false,
      issues: [{ path: ['scoreboard'], code: 'no_verified_run' }],
    });
    db.close();
  });

  it('refuses a result blob it cannot fully validate', () => {
    const db = openDatabase(':memory:');
    const planHash = registerPlan(db);
    // Drops holdMetrics: a partial object must not render as a zeroed row.
    saveRun(db, planHash, JSON.stringify({ holdout: { adopted: false, metrics: metrics() } }));

    expect(service(db).latest()).toEqual({
      ok: false,
      issues: [{ path: ['scoreboard'], code: 'unreadable_result' }],
    });
    db.close();
  });

  it('cannot be handed a non-JSON blob, because storage refuses to persist one', () => {
    const db = openDatabase(':memory:');
    const planHash = registerPlan(db);
    // saveResearchStudyRun JSON.parses resultJson before writing. The service
    // still guards its own parse as defence in depth against a row corrupted
    // below the application, but that state is unreachable through this path.
    expect(() => saveRun(db, planHash, '{"holdout":')).toThrow();
    db.close();
  });

  it('fails the whole read closed when a stored row no longer matches its hash', () => {
    const db = openDatabase(':memory:');
    saveRun(db, registerPlan(db));
    db.exec('DROP TRIGGER research_study_runs_no_update');
    db.exec("UPDATE research_study_runs SET adopted = 1 WHERE id = 'trendvol-replacement-v1'");

    // A study whose provenance cannot be verified must not reach a scoreboard.
    expect(service(db).latest()).toEqual({
      ok: false,
      issues: [{ path: ['scoreboard'], code: 'storage_rejected' }],
    });
    db.close();
  });

  it('keeps a null Sortino null rather than coercing it to zero', () => {
    const db = openDatabase(':memory:');
    const planHash = registerPlan(db);
    saveRun(db, planHash, resultJson({ holdMetrics: metrics({ sortino: null, sharpe: null }) }));

    const result = service(db).latest();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // An all-positive series has no downside deviation, so Sortino is undefined
    // rather than zero; zero would read as "no risk-adjusted return".
    expect(result.value.tracks[1]?.sortino).toBeNull();
    db.close();
  });

  it('returns null sample days when the plan cannot be loaded', () => {
    const db = openDatabase(':memory:');
    // The run carries a foreign key onto the plan, and both tables are
    // append-only by trigger, so reaching this state means damage below the
    // application — which is exactly when the field must degrade rather than
    // invent a sample length.
    const planHash = registerPlan(db);
    saveRun(db, planHash);
    db.exec('DROP TRIGGER research_preregistrations_no_delete');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('DELETE FROM research_preregistrations');

    const result = service(db).latest();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sampleDays).toBeNull();
    db.close();
  });
});
