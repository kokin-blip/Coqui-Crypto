import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export const OPERATIONS_WORKERS = ['host', 'market', 'risk', 'research', 'execution', 'advisor'] as const;
export type OperationsWorker = typeof OPERATIONS_WORKERS[number];
export type OperationsActivityStatus = 'running' | 'completed' | 'waiting' | 'blocked' | 'failed' | 'unknown' | 'cancelled';
export type OperationsActivitySource = 'paper_ledger' | 'exploratory' | 'parallel' | 'research' | 'advisor' | 'host' | 'market';
export const OPERATIONS_FACT_KEYS = ['instruments', 'reasonCode', 'gate', 'decisionId', 'runId', 'campaignId',
  'proposalId', 'clientOrderId', 'orderId', 'jobId', 'strategy', 'freshness', 'marketAsOfMs', 'momentumPct', 'volatilityPct',
  'targetWeight', 'filledCount', 'submittedCount', 'amountUsd', 'provider', 'operation', 'sourceRecord',
  'contentHash', 'sequence', 'gatesPassed', 'attempt', 'deadlineAtMs'] as const;
export type OperationsFacts = Readonly<Partial<Record<typeof OPERATIONS_FACT_KEYS[number], string | number | boolean | null>>>;
export interface OperationsActivityEvent {
  readonly id: string; readonly profileId: string; readonly workId: string; readonly attemptId: string;
  readonly worker: OperationsWorker; readonly source: OperationsActivitySource; readonly phase: string;
  readonly status: OperationsActivityStatus; readonly atMs: number; readonly deadlineAtMs: number | null;
  readonly facts: OperationsFacts; readonly contentHash: string;
}
export type NewOperationsActivity = Omit<OperationsActivityEvent, 'id' | 'contentHash'>;
const active = new WeakMap<Db, Set<string>>();
export function setOperationsAttemptActive(database: Db, attemptId: string, running: boolean): void {
  let ids = active.get(database);
  if (ids === undefined) { ids = new Set(); active.set(database, ids); }
  if (running) ids.add(attemptId); else ids.delete(attemptId);
}
export function operationsAttemptActive(database: Db, attemptId: string): boolean {
  return active.get(database)?.has(attemptId) === true;
}
export function validateOperationsFacts(facts: OperationsFacts): void {
  for (const [key, value] of Object.entries(facts)) {
    if(key==='reasonCode'&&value!==null&&(typeof value!=='string'||!/^[a-z][a-z0-9_]{0,79}$/u.test(value)))throw new TypeError('invalid_operations_reason');
    if (!(OPERATIONS_FACT_KEYS as readonly string[]).includes(key) ||
      !(value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ||
        typeof value === 'string' && value.length <= 512)) throw new TypeError('invalid_operations_fact');
  }
}
export function appendOperationsActivity(input: NewOperationsActivity, database: Db): OperationsActivityEvent {
  validateOperationsFacts(input.facts);
  if (!OPERATIONS_WORKERS.includes(input.worker) || !['paper_ledger','exploratory','parallel','research','advisor','host','market'].includes(input.source) ||
    !['running','completed','waiting','blocked','failed','unknown','cancelled'].includes(input.status) ||
    !/^[a-z][a-z0-9_]{0,63}$/u.test(input.phase) || !Number.isSafeInteger(input.atMs) || input.atMs < 0 ||
    input.deadlineAtMs !== null && (!Number.isSafeInteger(input.deadlineAtMs) || input.deadlineAtMs < input.atMs) ||
    [input.profileId,input.workId,input.attemptId].some(value => value.length < 1 || value.length > 200)) {
    throw new TypeError('invalid_operations_activity');
  }
  const json = canonicalJson(input as unknown as CanonicalJsonValue), contentHash = sha256Hex(json);
  const id = sha256Hex(`operations-activity-v1:${input.profileId}:${input.attemptId}:${input.worker}:${input.phase}:${input.status}`);
  const prior = database.prepare('SELECT content_hash FROM operations_activity_events_v1 WHERE id=?').get(id) as {content_hash:string}|undefined;
  if (prior !== undefined) { if (prior.content_hash !== contentHash) throw new Error('operations_activity_conflict'); }
  else database.prepare(`INSERT INTO operations_activity_events_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,
    input.profileId,input.workId,input.attemptId,input.worker,input.source,input.phase,input.status,input.atMs,
    input.deadlineAtMs,canonicalJson(input.facts as CanonicalJsonValue),contentHash);
  return { ...input, id, contentHash };
}
export function operationsActivityFromRow(row: Record<string, unknown>): OperationsActivityEvent {
  const value: NewOperationsActivity = { profileId:String(row['profile_id']),workId:String(row['work_id']),
    attemptId:String(row['attempt_id']),worker:row['worker'] as OperationsWorker,source:row['source'] as OperationsActivitySource,
    phase:String(row['phase']),status:row['status'] as OperationsActivityStatus,atMs:Number(row['at_ms']),
    deadlineAtMs:row['deadline_at_ms'] === null ? null : Number(row['deadline_at_ms']),
    facts:JSON.parse(String(row['facts_json'])) as OperationsFacts };
  validateOperationsFacts(value.facts);
  const contentHash=sha256Hex(canonicalJson(value as unknown as CanonicalJsonValue));
  const expectedId=sha256Hex(`operations-activity-v1:${value.profileId}:${value.attemptId}:${value.worker}:${value.phase}:${value.status}`);
  if(expectedId!==row['id'])throw new Error('operations_activity_identity');
  if (contentHash !== row['content_hash']) throw new Error('operations_activity_integrity');
  return { ...value,id:String(row['id']),contentHash };
}
