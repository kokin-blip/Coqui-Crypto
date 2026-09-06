import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson, FixedClock, sha256Hex, type CanonicalJsonValue } from '../packages/core/src/index.js';
import { createResearchWorkerEnvelope, ResearchWorkerFailure, ResearchWorkerPool,
  validateResearchWorkerEnvelope } from '../packages/services/src/index.js';
import { finishResearchWorkerAttempt, getResearchJob, getResearchWorkerAttempt, openDatabase,
  saveResearchJob, startResearchWorkerAttempt } from '../packages/storage/src/index.js';

const snapshot = { oosReturns: [2, -1, 3], walkForwardReturns: [[1, 2], [-1, 2]], stressReturns: [-2, 3] } as const;
const definition = { operation: 'evaluate_candidate_v1', candidateId: 'candidate-a', turnoverPct: 12, trialCount: 4 } as const;
function prepare(id: string, database: ReturnType<typeof openDatabase>): void {
  saveResearchJob({ id, kind: 'matrix', status: 'queued', createdAt: 1, startedAt: null,
    completedAt: null, requestJson: '{}', snapshotJson: canonicalJson(snapshot as unknown as CanonicalJsonValue),
    progressJson: '{}', resultJson: null, error: null }, database);
}

describe('bounded research worker pool', () => {
  it('executes in a worker, persists hashes, and replays deterministically', async () => {
    const database = openDatabase(':memory:'), clock = new FixedClock(10);
    prepare('job-a', database); prepare('job-b', database);
    const pool = new ResearchWorkerPool({ database, clock });
    const first = await pool.run('job-a', definition, snapshot);
    const second = await pool.run('job-b', definition, snapshot);
    expect(first.metrics.oosReturnPct).toBeCloseTo(4.0094);
    expect(first.metrics).toEqual(second.metrics);
    const stored = getResearchJob('job-a', database)!;
    expect(stored.status).toBe('completed');
    expect(stored.resultHash).toMatch(/^[a-f0-9]{64}$/u);
    const attemptId = (database.prepare('SELECT id FROM research_worker_attempts_v1 WHERE job_id=?')
      .get('job-a') as { id: string }).id;
    expect(getResearchWorkerAttempt(attemptId, database)?.resultHash).toBe(stored.resultHash);
    database.close();
  });

  it('cancels and times out without accepting a stale result', async () => {
    const database = openDatabase(':memory:'), clock = new FixedClock(20);
    prepare('cancelled', database); prepare('timed', database);
    const controller = new AbortController(); controller.abort();
    await expect(new ResearchWorkerPool({ database, clock }).run('cancelled', definition, snapshot, controller.signal))
      .rejects.toMatchObject({ code: 'cancelled' });
    await expect(new ResearchWorkerPool({ database, clock, timeoutMs: 0 }).run('timed', definition, snapshot))
      .rejects.toMatchObject({ code: 'timed_out' });
    expect(getResearchJob('cancelled', database)?.status).toBe('cancelled');
    expect(getResearchJob('timed', database)?.errorCode).toBe('timed_out');
    database.close();
  });

  it('rejects protocol mismatch, mutable snapshots, and authority-shaped fields', async () => {
    const database = openDatabase(':memory:'), clock = new FixedClock(30);
    prepare('job', database);
    const envelope = createResearchWorkerEnvelope('job', definition, snapshot);
    expect(() => validateResearchWorkerEnvelope({ ...envelope, protocolHash: '0'.repeat(64) })).toThrow('invalid_research_worker_envelope');
    expect(() => validateResearchWorkerEnvelope({ ...envelope, secretRef: 'forbidden' } as never)).toThrow('invalid_research_worker_envelope');
    await expect(new ResearchWorkerPool({ database, clock }).run('job', definition,
      { ...snapshot, oosReturns: [99] })).rejects.toBeInstanceOf(ResearchWorkerFailure);
    database.close();
  });

  it('keeps the worker entrypoint outside secret and execution packages', () => {
    for (const name of ['research-worker.ts', 'research-worker.mjs']) {
      const source = readFileSync(new URL(`../packages/services/src/research/${name}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/@coqui\/(?:storage|adapters)|oms|credential|secret|execution-service|profile-repositor/iu);
    }
  });

  it('recovers interrupted attempts and rejects duplicate completion', () => {
    const database = openDatabase(':memory:'), clock = new FixedClock(40);
    prepare('recover', database);
    const envelope = createResearchWorkerEnvelope('recover', definition, snapshot);
    const json = canonicalJson(envelope as unknown as CanonicalJsonValue);
    const attempt = startResearchWorkerAttempt('recover', json, sha256Hex(json), 30, database);
    saveResearchJob({ ...getResearchJob('recover', database)!, status: 'running', startedAt: 30 }, database);
    const recovered = new ResearchWorkerPool({ database, clock }).recover();
    expect(recovered).toEqual({ attemptsFailed: 1, jobsRequeued: 1, jobsFailed: 0 });
    expect(getResearchWorkerAttempt(attempt.id, database)?.errorCode).toBe('worker_interrupted');
    expect(finishResearchWorkerAttempt(attempt.id, 'completed', 50, '{}',
      sha256Hex('{}'), null, database)).toBe(false);
    database.close();
  });

  it('rejects an older attempt after a replacement starts', () => {
    const database = openDatabase(':memory:'); prepare('stale', database);
    const envelope = createResearchWorkerEnvelope('stale', definition, snapshot);
    const json = canonicalJson(envelope as unknown as CanonicalJsonValue), hash = sha256Hex(json);
    const older = startResearchWorkerAttempt('stale', json, hash, 1, database);
    const newer = startResearchWorkerAttempt('stale', json, hash, 2, database);
    expect(finishResearchWorkerAttempt(older.id, 'completed', 3, '{}', sha256Hex('{}'), null, database)).toBe(false);
    expect(getResearchWorkerAttempt(older.id, database)).toMatchObject({ status: 'failed', errorCode: 'stale_result' });
    expect(finishResearchWorkerAttempt(newer.id, 'completed', 4, '{}', sha256Hex('{}'), null, database)).toBe(true);
    database.close();
  });
});
