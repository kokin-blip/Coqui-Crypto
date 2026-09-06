import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { canonicalJson, createSemaphore, sha256Hex, type CanonicalJsonValue, type Clock, type Semaphore } from '@coqui/core';
import { appendResearchJobEvent, finishResearchWorkerAttempt, getResearchJob,
  recoverInterruptedResearchJobs, recoverResearchWorkerAttempts, saveResearchJob,
  startResearchWorkerAttempt, type Db, type StoredResearchJob } from '@coqui/storage';
import { createResearchWorkerEnvelope, researchWorkerEnvelopeJson, validateResearchWorkerResult,
  type ResearchWorkerDefinitionV1, type ResearchWorkerResultV1, type ResearchWorkerSnapshotV1 } from './worker-protocol.js';

export type ResearchWorkerFailureCode = 'job_not_found' | 'snapshot_mismatch' | 'cancelled' |
  'timed_out' | 'worker_crashed' | 'protocol_mismatch' | 'stale_result';

export class ResearchWorkerFailure extends Error {
  constructor(readonly code: ResearchWorkerFailureCode) { super(code); }
}
function workerUrl(): URL {
  const built = new URL('./research-worker.js', import.meta.url);
  return existsSync(fileURLToPath(built)) ? built : new URL('./research-worker.mjs', import.meta.url);
}
function updateJob(job: StoredResearchJob, values: Partial<StoredResearchJob>, database: Db): void {
  saveResearchJob({ ...job, ...values }, database);
}

export interface ResearchWorkerPoolOptions {
  readonly database: Db; readonly clock: Clock; readonly concurrency?: number;
  readonly timeoutMs?: number; readonly maxOldGenerationSizeMb?: number;
}

export class ResearchWorkerPool {
  readonly #database: Db; readonly #clock: Clock; readonly #slots: Semaphore;
  readonly #timeoutMs: number; readonly #memoryMb: number;
  constructor(options: ResearchWorkerPoolOptions) {
    this.#database = options.database; this.#clock = options.clock;
    this.#slots = createSemaphore(options.concurrency ?? 2);
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#memoryMb = options.maxOldGenerationSizeMb ?? 64;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 0) throw new RangeError('Invalid worker timeout.');
    if (!Number.isSafeInteger(this.#memoryMb) || this.#memoryMb < 16 || this.#memoryMb > 256) throw new RangeError('Invalid worker memory limit.');
  }

  active(): number { return this.#slots.active(); }
  pending(): number { return this.#slots.pending(); }
  recover(): { readonly attemptsFailed: number; readonly jobsRequeued: number; readonly jobsFailed: number } {
    const now = this.#clock.nowMs();
    const attemptsFailed = recoverResearchWorkerAttempts(now, this.#database);
    const jobs = recoverInterruptedResearchJobs(now, this.#database);
    return { attemptsFailed, jobsRequeued: jobs.requeued, jobsFailed: jobs.failed };
  }

  run(jobId: string, definition: ResearchWorkerDefinitionV1, snapshot: ResearchWorkerSnapshotV1,
    signal?: AbortSignal): Promise<ResearchWorkerResultV1> {
    return this.#slots.run(async () => {
      const job = getResearchJob(jobId, this.#database);
      if (job === null) throw new ResearchWorkerFailure('job_not_found');
      const prepared = job.snapshotJson === null ? null : canonicalJson(JSON.parse(job.snapshotJson) as CanonicalJsonValue);
      const supplied = canonicalJson(snapshot as unknown as CanonicalJsonValue);
      if (prepared !== supplied) throw new ResearchWorkerFailure('snapshot_mismatch');
      const envelope = createResearchWorkerEnvelope(jobId, definition, snapshot);
      const envelopeJson = researchWorkerEnvelopeJson(envelope), envelopeHash = sha256Hex(envelopeJson);
      const startedAt = this.#clock.nowMs();
      const attempt = startResearchWorkerAttempt(jobId, envelopeJson, envelopeHash, startedAt, this.#database);
      updateJob(job, { status: 'running', startedAt, completedAt: null, resultJson: null,
        resultHash: null, error: null, errorCode: null, attemptCount: attempt.attemptNumber,
        deadlineAt: startedAt + this.#timeoutMs,
        progressJson: '{"phase":"running","percent":0}' }, this.#database);
      appendResearchJobEvent(jobId, 'worker_started', JSON.stringify({ attemptId: attempt.id }), startedAt, this.#database);
      try {
        const result = await this.#execute(envelope, envelopeHash, signal);
        const resultJson = canonicalJson(result as unknown as CanonicalJsonValue), resultHash = sha256Hex(resultJson);
        if (!finishResearchWorkerAttempt(attempt.id, 'completed', this.#clock.nowMs(), resultJson, resultHash, null, this.#database)) {
          throw new ResearchWorkerFailure('stale_result');
        }
        const completedAt = this.#clock.nowMs();
        updateJob(job, { status: 'completed', startedAt, completedAt, resultJson, resultHash,
          error: null, errorCode: null, attemptCount: attempt.attemptNumber,
          progressJson: '{"phase":"completed","percent":100}' }, this.#database);
        appendResearchJobEvent(jobId, 'worker_completed', JSON.stringify({ attemptId: attempt.id, resultHash }), completedAt, this.#database);
        return result;
      } catch (error) {
        const failure = error instanceof ResearchWorkerFailure ? error : new ResearchWorkerFailure('worker_crashed');
        if (failure.code === 'stale_result') {
          appendResearchJobEvent(jobId, 'worker_failed', JSON.stringify({ attemptId: attempt.id,
            code: failure.code }), this.#clock.nowMs(), this.#database);
          throw failure;
        }
        const status = failure.code === 'cancelled' ? 'cancelled' : failure.code === 'timed_out' ? 'timed_out' : 'failed';
        const completedAt = this.#clock.nowMs();
        if (!finishResearchWorkerAttempt(attempt.id, status, completedAt, null, null, failure.code, this.#database)) {
          appendResearchJobEvent(jobId, 'worker_failed', JSON.stringify({ attemptId: attempt.id,
            code: 'stale_result' }), completedAt, this.#database);
          throw new ResearchWorkerFailure('stale_result');
        }
        updateJob(job, { status: status === 'cancelled' ? 'cancelled' : 'failed', startedAt, completedAt,
          resultJson: null, resultHash: null, error: failure.code, errorCode: failure.code,
          attemptCount: attempt.attemptNumber, progressJson: JSON.stringify({ phase: status, percent: 0 }) }, this.#database);
        appendResearchJobEvent(jobId, `worker_${status}`, JSON.stringify({ attemptId: attempt.id, code: failure.code }), completedAt, this.#database);
        throw failure;
      }
    });
  }

  #execute(envelope: ReturnType<typeof createResearchWorkerEnvelope>, envelopeHash: string,
    signal?: AbortSignal): Promise<ResearchWorkerResultV1> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl(), { workerData: envelope,
        resourceLimits: { maxOldGenerationSizeMb: this.#memoryMb, maxYoungGenerationSizeMb: 16 } });
      let settled = false;
      const done = (action: () => void) => { if (settled) return; settled = true; clearTimeout(timer);
        signal?.removeEventListener('abort', cancel); void worker.terminate(); action(); };
      const cancel = () => done(() => reject(new ResearchWorkerFailure('cancelled')));
      const timer = setTimeout(() => done(() => reject(new ResearchWorkerFailure('timed_out'))), this.#timeoutMs);
      timer.unref?.();
      if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
      worker.once('message', (message: unknown) => done(() => {
        try { const result = message as ResearchWorkerResultV1;
          validateResearchWorkerResult(result, envelope, envelopeHash); resolve(result);
        } catch { reject(new ResearchWorkerFailure('protocol_mismatch')); }
      }));
      worker.once('error', () => done(() => reject(new ResearchWorkerFailure('worker_crashed'))));
      worker.once('exit', (code) => { if (code !== 0) done(() => reject(new ResearchWorkerFailure('worker_crashed'))); });
    });
  }
}
