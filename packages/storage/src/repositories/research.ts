import { createHash } from 'node:crypto';

import type { Db } from '../sqlite/index.js';

export interface StoredResearchRun {
  readonly id: string;
  readonly status: 'running' | 'completed' | 'cancelled' | 'failed';
  readonly createdAt: number;
  readonly completedAt: number | null;
  readonly manifestJson: string;
  readonly resultJson: string | null;
  readonly error: string | null;
}

export interface StoredResearchJob {
  readonly id: string;
  readonly kind: 'matrix' | 'stress';
  readonly status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly requestJson: string;
  readonly snapshotJson: string | null;
  readonly progressJson: string;
  readonly resultJson: string | null;
  readonly error: string | null;
  readonly formatVersion?: number;
  readonly snapshotHash?: string | null;
  readonly resultHash?: string | null;
  readonly attemptCount?: number;
  readonly deadlineAt?: number | null;
  readonly errorCode?: string | null;
}

interface ResearchJobRow {
  id: string;
  kind: StoredResearchJob['kind'];
  status: StoredResearchJob['status'];
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  request_json: string;
  snapshot_json: string | null;
  progress_json: string;
  result_json: string | null;
  error: string | null;
  format_version: number;
  snapshot_hash: string | null;
  result_hash: string | null;
  attempt_count: number;
  deadline_at: number | null;
  error_code: string | null;
}

function assertJson(value: string | null, label: string): void {
  if (value === null) return;
  try {
    JSON.parse(value);
  } catch {
    throw new TypeError(`${label} must be valid JSON.`);
  }
}

function hash(value: string | null): string | null {
  return value === null ? null : createHash('sha256').update(value).digest('hex');
}

function jobFromRow(row: ResearchJobRow): StoredResearchJob {
  const snapshotMismatch = row.snapshot_json !== null &&
    row.snapshot_hash !== null && hash(row.snapshot_json) !== row.snapshot_hash;
  const resultMismatch = row.result_json !== null &&
    row.result_hash !== null && hash(row.result_json) !== row.result_hash;
  const job: StoredResearchJob = {
    id: row.id,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    requestJson: row.request_json,
    snapshotJson: row.snapshot_json,
    progressJson: row.progress_json,
    resultJson: row.result_json,
    error: row.error,
    formatVersion: row.format_version,
    snapshotHash: row.snapshot_hash,
    resultHash: row.result_hash,
    attemptCount: row.attempt_count,
    deadlineAt: row.deadline_at,
    errorCode: row.error_code,
  };
  if (!snapshotMismatch && !resultMismatch) return job;
  return {
    ...job,
    status: 'failed',
    resultJson: null,
    error: `Stored research ${snapshotMismatch ? 'snapshot' : 'result'} integrity validation failed.`,
    errorCode: 'integrity_mismatch',
  };
}

export function saveResearchRun(run: StoredResearchRun, database: Db): void {
  assertJson(run.manifestJson, 'Research manifest');
  assertJson(run.resultJson, 'Research result');
  const existing = database.prepare(
    'SELECT created_at, manifest_json FROM research_runs WHERE id = ?',
  ).get(run.id) as unknown as { created_at: number; manifest_json: string } | undefined;
  if (existing && (
    existing.created_at !== run.createdAt || existing.manifest_json !== run.manifestJson
  )) throw new Error('Research run identity and registered manifest are immutable.');
  database.prepare(`
    INSERT INTO research_runs
      (id, status, created_at, completed_at, manifest_json, result_json, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      completed_at = excluded.completed_at,
      result_json = excluded.result_json,
      error = excluded.error
    WHERE research_runs.created_at = excluded.created_at
      AND research_runs.manifest_json = excluded.manifest_json
  `).run(
    run.id,
    run.status,
    run.createdAt,
    run.completedAt,
    run.manifestJson,
    run.resultJson,
    run.error,
  );
}

export function listResearchRuns(database: Db, limit = 20): StoredResearchRun[] {
  const rows = database.prepare(
    'SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ?',
  ).all(Math.max(1, Math.min(100, Math.floor(limit)))) as unknown as Array<{
    id: string;
    status: StoredResearchRun['status'];
    created_at: number;
    completed_at: number | null;
    manifest_json: string;
    result_json: string | null;
    error: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    manifestJson: row.manifest_json,
    resultJson: row.result_json,
    error: row.error,
  }));
}

export function finalizeInterruptedResearchRuns(now: number, database: Db): number {
  const result = database.prepare(`
    UPDATE research_runs SET status = 'failed', completed_at = ?,
      error = 'The app closed before this research run finished.'
    WHERE status = 'running'
  `).run(now);
  return Number(result.changes);
}

export function saveResearchJob(job: StoredResearchJob, database: Db): void {
  for (const [value, label] of [
    [job.requestJson, 'Research request'],
    [job.snapshotJson, 'Research snapshot'],
    [job.progressJson, 'Research progress'],
    [job.resultJson, 'Research result'],
  ] as const) assertJson(value, label);
  const existing = database.prepare(`
    SELECT kind, created_at, request_json, snapshot_json
    FROM research_jobs WHERE id = ?
  `).get(job.id) as {
    kind: string;
    created_at: number;
    request_json: string;
    snapshot_json: string | null;
  } | undefined;
  if (
    existing &&
    (
      existing.kind !== job.kind ||
      existing.created_at !== job.createdAt ||
      existing.request_json !== job.requestJson ||
      (existing.snapshot_json !== null && existing.snapshot_json !== job.snapshotJson)
    )
  ) throw new Error('Research job identity and prepared snapshot are immutable.');

  const snapshotHash = job.snapshotHash ?? hash(job.snapshotJson);
  const resultHash = job.resultHash ?? hash(job.resultJson);
  database.prepare(`
    INSERT INTO research_jobs (
      id, kind, status, created_at, started_at, completed_at, request_json,
      snapshot_json, progress_json, result_json, error, format_version,
      snapshot_hash, result_hash, attempt_count, deadline_at, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      snapshot_json = excluded.snapshot_json,
      progress_json = excluded.progress_json,
      result_json = excluded.result_json,
      error = excluded.error,
      snapshot_hash = excluded.snapshot_hash,
      result_hash = excluded.result_hash,
      attempt_count = excluded.attempt_count,
      deadline_at = excluded.deadline_at,
      error_code = excluded.error_code
  `).run(
    job.id,
    job.kind,
    job.status,
    job.createdAt,
    job.startedAt,
    job.completedAt,
    job.requestJson,
    job.snapshotJson,
    job.progressJson,
    job.resultJson,
    job.error,
    job.formatVersion ?? 2,
    snapshotHash,
    resultHash,
    job.attemptCount ?? 0,
    job.deadlineAt ?? null,
    job.errorCode ?? null,
  );
}

export function getResearchJob(id: string, database: Db): StoredResearchJob | null {
  const row = database.prepare('SELECT * FROM research_jobs WHERE id = ?').get(id) as
    ResearchJobRow | undefined;
  return row ? jobFromRow(row) : null;
}

export function listResearchJobs(database: Db, limit = 100): StoredResearchJob[] {
  const rows = database.prepare(
    'SELECT * FROM research_jobs ORDER BY created_at DESC LIMIT ?',
  ).all(Math.max(1, Math.min(500, Math.floor(limit)))) as unknown as ResearchJobRow[];
  return rows.map(jobFromRow);
}

/** Append one immutable research lifecycle event. */
export function appendResearchJobEvent(
  jobId: string,
  event: string,
  detailJson: string | null,
  at: number,
  database: Db,
): void {
  assertJson(detailJson, 'Research event detail');
  database.prepare(`
    INSERT INTO research_job_events (job_id, at, event, detail_json)
    VALUES (?, ?, ?, ?)
  `).run(jobId, at, event, detailJson);
}

export function recoverInterruptedResearchJobs(
  now: number,
  database: Db,
): { requeued: number; failed: number } {
  const requeued = database.prepare(`
    UPDATE research_jobs
    SET status = 'queued', started_at = NULL, progress_json = ?, error = NULL
    WHERE status = 'running' AND snapshot_json IS NOT NULL
  `).run(JSON.stringify({
    completed: 0,
    total: 1,
    percent: 0,
    phase: 'queued',
    message: 'Recovered after app restart.',
  }));
  const failed = database.prepare(`
    UPDATE research_jobs
    SET status = 'failed', completed_at = ?, error = ?
    WHERE status = 'running' AND snapshot_json IS NULL
  `).run(now, 'The app closed before the research snapshot was prepared.');
  return { requeued: Number(requeued.changes), failed: Number(failed.changes) };
}
