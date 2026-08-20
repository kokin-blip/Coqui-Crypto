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
  ResearchReadModelService,
} from '../packages/services/src/index.js';
import {
  openDatabase,
  researchStudyRunHash,
  saveResearchJob,
  saveResearchStudyRun,
  type Db,
  type ResearchStudyRunWithoutHash,
  type StoredResearchJob,
} from '../packages/storage/src/index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const CANDIDATE = 'e'.repeat(64);

function database(): Db {
  return openDatabase(':memory:');
}

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2020, 0, 1);
const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
const ETH = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });

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

/** research_study_runs carries a foreign key onto a registered plan. */
function registerPlan(db: Db): string {
  const plan: ResearchPreRegistration = {
    schemaVersion: 1,
    id: 'trendvol-replacement-v1-plan',
    registeredAt: '2026-08-09T00:00:00.000Z',
    family: 'trendvol',
    hypothesis: 'Trend-vol produces positive excess returns on untouched data.',
    parameterSpace: PARAMETER_SPACE,
    candidateCount: gridCandidateCount(PARAMETER_SPACE),
    datasetHash: HASH_B,
    costProfileHash: tradeCostConfigHash(DEFAULT_TRADE_COST_CONFIG),
    codeRevision: '037927e6b876a86b53f6a9977d35fd0df1a37873',
    execution: {
      baseTargets: [
        { assetId: BTC, weight: 0.5 },
        { assetId: ETH, weight: 0.5 },
      ],
      warmupBars: 10,
      cashAprPct: 0,
    },
    validation: {
      development: { startMs: START_MS, endExclusiveMs: START_MS + 90 * DAY_MS },
      holdout: { startMs: START_MS + 90 * DAY_MS, endExclusiveMs: START_MS + 122 * DAY_MS },
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

function studyRun(overrides: Partial<ResearchStudyRunWithoutHash> = {}): ResearchStudyRunWithoutHash {
  return {
    id: 'trendvol-replacement-v1',
    preRegistrationHash: HASH_A,
    completedAtMs: 1_723_000_000_000,
    datasetHash: HASH_B,
    costProfileHash: HASH_C,
    codeRevision: '037927e6b876a86b53f6a9977d35fd0df1a37873',
    selectedCandidateId: CANDIDATE,
    adopted: false,
    resultJson: '{"pbo":0.286}',
    ...overrides,
  };
}

function job(overrides: Partial<StoredResearchJob> = {}): StoredResearchJob {
  return {
    id: 'job-1',
    kind: 'matrix',
    status: 'completed',
    createdAt: 1_723_000_000_000,
    startedAt: 1_723_000_001_000,
    completedAt: 1_723_000_002_000,
    requestJson: '{"kind":"matrix"}',
    snapshotJson: '{"rows":[]}',
    progressJson: '{"done":1}',
    resultJson: '{"score":1}',
    error: null,
    ...overrides,
  };
}

function service(db: Db): ResearchReadModelService {
  return new ResearchReadModelService({ database: db });
}

describe('ResearchReadModelService.runs', () => {
  it('returns the immutable identities that make a result citable', () => {
    const db = database();
    const run = studyRun({ preRegistrationHash: registerPlan(db) });
    saveResearchStudyRun({ ...run, runHash: researchStudyRunHash(run) }, db);

    const result = service(db).runs();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        id: 'trendvol-replacement-v1',
        preRegistrationHash: run.preRegistrationHash,
        datasetHash: HASH_B,
        costProfileHash: HASH_C,
        codeRevision: '037927e6b876a86b53f6a9977d35fd0df1a37873',
        selectedCandidateId: CANDIDATE,
        adopted: false,
        completedAtMs: 1_723_000_000_000,
        runHash: researchStudyRunHash(run),
      },
    ]);
    db.close();
  });

  it('never returns the stored result payload itself', () => {
    const db = database();
    const run = studyRun({
      preRegistrationHash: registerPlan(db),
      resultJson: '{"secretish":"large blob"}',
    });
    saveResearchStudyRun({ ...run, runHash: researchStudyRunHash(run) }, db);

    const result = service(db).runs();
    expect(JSON.stringify(result)).not.toContain('large blob');
    db.close();
  });

  it('fails the whole read closed when a row no longer matches its hash', () => {
    const db = database();
    const run = studyRun({ preRegistrationHash: registerPlan(db) });
    saveResearchStudyRun({ ...run, runHash: researchStudyRunHash(run) }, db);

    // Migration 37 installs triggers that make these rows append-only, so
    // reaching a corrupt row means dropping the guard first. That is exactly
    // the situation this test covers: damage that arrived below the
    // application, not through it.
    db.exec('DROP TRIGGER research_study_runs_no_update');
    db.exec("UPDATE research_study_runs SET adopted = 1 WHERE id = 'trendvol-replacement-v1'");

    expect(service(db).runs()).toEqual({
      ok: false,
      issues: [{ path: ['runs'], code: 'storage_rejected' }],
    });
    db.close();
  });
});

describe('ResearchReadModelService.jobs', () => {
  it('summarises jobs and bounds the limit', () => {
    const db = database();
    saveResearchJob(job(), db);

    const svc = service(db);
    const listed = svc.jobs(10);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toEqual([
      {
        id: 'job-1',
        kind: 'matrix',
        status: 'completed',
        createdAtMs: 1_723_000_000_000,
        startedAtMs: 1_723_000_001_000,
        completedAtMs: 1_723_000_002_000,
        attemptCount: 0,
        failureReason: 'none',
      },
    ]);

    expect(svc.jobs(0)).toEqual({
      ok: false,
      issues: [{ path: ['jobs', 'limit'], code: 'invalid_limit' }],
    });
    expect(svc.jobs(201)).toEqual({
      ok: false,
      issues: [{ path: ['jobs', 'limit'], code: 'invalid_limit' }],
    });
    db.close();
  });

  it('maps failures to stable reasons and never forwards the worker message', () => {
    const db = database();
    const leak = 'ENOENT /Users/someone/private/dataset.parquet at Worker.run (worker.js:42)';
    saveResearchJob(job({ id: 'failed', status: 'failed', error: leak, resultJson: null }), db);
    saveResearchJob(
      job({ id: 'timeout', status: 'failed', error: leak, errorCode: 'deadline_exceeded', resultJson: null }),
      db,
    );
    saveResearchJob(job({ id: 'stopped', status: 'cancelled', error: leak, resultJson: null }), db);

    const result = service(db).jobs();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const reasons = Object.fromEntries(result.value.map((row) => [row.id, row.failureReason]));
    expect(reasons).toEqual({
      failed: 'worker_failed',
      timeout: 'deadline_exceeded',
      stopped: 'cancelled',
    });
    expect(JSON.stringify(result)).not.toContain('ENOENT');
    expect(JSON.stringify(result)).not.toContain('/Users/');
    db.close();
  });

  it('keeps a corrupt row distinguishable from an unsuccessful study', () => {
    const db = database();
    // A digest that does not match the payload is how storage corruption
    // presents. The repository fails the row closed; the view must report that
    // as an integrity problem, not as a strategy that failed.
    saveResearchJob(job({ id: 'corrupt', resultHash: HASH_D }), db);

    const result = service(db).jobs();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.status).toBe('failed');
    expect(result.value[0]?.failureReason).toBe('integrity_mismatch');
    expect(JSON.stringify(result)).not.toContain('integrity validation failed');
    db.close();
  });

  it('treats an unrecognised stored error code as a generic worker failure', () => {
    const db = database();
    saveResearchJob(
      job({ id: 'odd', status: 'failed', errorCode: 'something-a-worker-wrote', resultJson: null }),
      db,
    );

    const result = service(db).jobs();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.failureReason).toBe('worker_failed');
    expect(JSON.stringify(result)).not.toContain('something-a-worker-wrote');
    db.close();
  });
});

describe('ResearchReadModelService.job', () => {
  it('reports payload presence without returning the payloads', () => {
    const db = database();
    saveResearchJob(
      job({
        snapshotJson: '{"huge":"snapshot blob"}',
        resultJson: '{"huge":"result blob"}',
        formatVersion: 2,
        deadlineAt: 1_723_000_009_000,
        attemptCount: 3,
      }),
      db,
    );

    const result = service(db).job('job-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hasSnapshot).toBe(true);
    expect(result.value.hasResult).toBe(true);
    expect(result.value.snapshotHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.value.resultHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.value.formatVersion).toBe(2);
    expect(result.value.attemptCount).toBe(3);
    expect(JSON.stringify(result)).not.toContain('blob');
    db.close();
  });

  it('rejects a malformed id before touching storage and reports an unknown one', () => {
    const db = database();
    const svc = service(db);

    expect(svc.job('../../etc/passwd')).toEqual({
      ok: false,
      issues: [{ path: ['job', 'id'], code: 'invalid_id' }],
    });
    expect(svc.job('')).toEqual({
      ok: false,
      issues: [{ path: ['job', 'id'], code: 'invalid_id' }],
    });
    expect(svc.job('missing-job')).toEqual({
      ok: false,
      issues: [{ path: ['job'], code: 'unknown_job' }],
    });
    db.close();
  });

  it('discards a stored hash that is not a sha-256 digest', () => {
    const db = database();
    saveResearchJob(job({ snapshotJson: null, snapshotHash: 'not-a-hash', resultJson: null }), db);

    const result = service(db).job('job-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshotHash).toBeNull();
    expect(result.value.hasSnapshot).toBe(false);
    db.close();
  });
});
