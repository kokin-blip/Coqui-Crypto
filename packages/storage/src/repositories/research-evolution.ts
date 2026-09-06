import { sha256Hex } from '@coqui/core';
import type { Db } from '../sqlite/index.js';
import { inTransaction } from '../sqlite/index.js';

export type WorkerAttemptStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'timed_out';
export interface ResearchWorkerAttempt {
  readonly id: string; readonly jobId: string; readonly attemptNumber: number;
  readonly protocolVersion: 1; readonly envelopeJson: string; readonly envelopeHash: string;
  readonly status: WorkerAttemptStatus; readonly startedAt: number; readonly completedAt: number | null;
  readonly resultJson: string | null; readonly resultHash: string | null; readonly errorCode: string | null;
}

function validJson(value: string, label: string): void {
  try { JSON.parse(value); } catch { throw new TypeError(`${label} must be valid JSON.`); }
}

function attempt(row: Record<string, unknown>): ResearchWorkerAttempt {
  return {
    id: String(row['id']), jobId: String(row['job_id']), attemptNumber: Number(row['attempt_number']),
    protocolVersion: 1, envelopeJson: String(row['envelope_json']), envelopeHash: String(row['envelope_hash']),
    status: row['status'] as WorkerAttemptStatus, startedAt: Number(row['started_at']),
    completedAt: row['completed_at'] === null ? null : Number(row['completed_at']),
    resultJson: row['result_json'] === null ? null : String(row['result_json']),
    resultHash: row['result_hash'] === null ? null : String(row['result_hash']),
    errorCode: row['error_code'] === null ? null : String(row['error_code']),
  };
}

export function startResearchWorkerAttempt(
  jobId: string, envelopeJson: string, envelopeHash: string, startedAt: number, database: Db,
): ResearchWorkerAttempt {
  validJson(envelopeJson, 'Worker envelope');
  if (sha256Hex(envelopeJson) !== envelopeHash) throw new Error('Worker envelope hash mismatch.');
  return inTransaction(database, () => {
    const row = database.prepare(`SELECT COALESCE(MAX(attempt_number),0) + 1 AS next
      FROM research_worker_attempts_v1 WHERE job_id = ?`).get(jobId) as { next: number };
    const id = sha256Hex(`research-worker-attempt-v1:${jobId}:${row.next}`);
    database.prepare(`INSERT INTO research_worker_attempts_v1
      (id,job_id,attempt_number,protocol_version,envelope_json,envelope_hash,status,started_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, jobId, row.next, 1, envelopeJson, envelopeHash, 'running', startedAt);
    return getResearchWorkerAttempt(id, database)!;
  });
}

export function finishResearchWorkerAttempt(
  id: string, status: Exclude<WorkerAttemptStatus, 'running'>, completedAt: number,
  resultJson: string | null, resultHash: string | null, errorCode: string | null, database: Db,
): boolean {
  if (resultJson !== null) validJson(resultJson, 'Worker result');
  if ((resultJson === null) !== (resultHash === null) ||
      (resultJson !== null && sha256Hex(resultJson) !== resultHash)) throw new Error('Worker result hash mismatch.');
  return inTransaction(database, () => {
    const row = database.prepare(`SELECT status, attempt_number,
      (SELECT MAX(newer.attempt_number) FROM research_worker_attempts_v1 newer
        WHERE newer.job_id=current.job_id) AS latest_attempt
      FROM research_worker_attempts_v1 current WHERE id=?`).get(id) as
      { status: WorkerAttemptStatus; attempt_number: number; latest_attempt: number } | undefined;
    if (row === undefined || row.status !== 'running') return false;
    const latest = row.attempt_number === row.latest_attempt;
    database.prepare(`UPDATE research_worker_attempts_v1 SET
      status=?, completed_at=?, result_json=?, result_hash=?, error_code=? WHERE id=?`).run(
        latest ? status : 'failed', completedAt, latest ? resultJson : null,
        latest ? resultHash : null, latest ? errorCode : 'stale_result', id);
    return latest;
  });
}

export function getResearchWorkerAttempt(id: string, database: Db): ResearchWorkerAttempt | null {
  const row = database.prepare('SELECT * FROM research_worker_attempts_v1 WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  const value = attempt(row);
  if (sha256Hex(value.envelopeJson) !== value.envelopeHash ||
      (value.resultJson !== null && sha256Hex(value.resultJson) !== value.resultHash)) {
    throw new Error('Stored worker attempt failed integrity validation.');
  }
  return value;
}

export function recoverResearchWorkerAttempts(now: number, database: Db): number {
  const result = database.prepare(`UPDATE research_worker_attempts_v1 SET status='failed',
    completed_at=?, error_code='worker_interrupted' WHERE status='running'`).run(now);
  return Number(result.changes);
}

export interface ResearchCandidateRecord {
  readonly id: string; readonly family: string; readonly strategyVersion: string;
  readonly parentId: string | null; readonly evidenceId: string; readonly evidenceHash: string;
  readonly metricsJson: string; readonly metricsHash: string;
  readonly state: 'promotion_eligible' | 'rejected'; readonly reasonCodesJson: string;
  readonly createdAt: number;
}

export function saveResearchCandidate(candidate: ResearchCandidateRecord, database: Db): void {
  validJson(candidate.metricsJson, 'Candidate metrics'); validJson(candidate.reasonCodesJson, 'Candidate reasons');
  if (sha256Hex(candidate.metricsJson) !== candidate.metricsHash) throw new Error('Candidate metrics hash mismatch.');
  database.prepare(`INSERT INTO research_candidates_v1
    (id,family,strategy_version,parent_id,evidence_id,evidence_hash,metrics_json,metrics_hash,state,reason_codes_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(candidate.id, candidate.family, candidate.strategyVersion,
      candidate.parentId, candidate.evidenceId, candidate.evidenceHash, candidate.metricsJson,
      candidate.metricsHash, candidate.state, candidate.reasonCodesJson, candidate.createdAt);
}

export function getResearchCandidate(id: string, database: Db): ResearchCandidateRecord | null {
  const row = database.prepare('SELECT * FROM research_candidates_v1 WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  const value: ResearchCandidateRecord = {
    id: String(row['id']), family: String(row['family']), strategyVersion: String(row['strategy_version']),
    parentId: row['parent_id'] === null ? null : String(row['parent_id']), evidenceId: String(row['evidence_id']),
    evidenceHash: String(row['evidence_hash']), metricsJson: String(row['metrics_json']),
    metricsHash: String(row['metrics_hash']), state: row['state'] as ResearchCandidateRecord['state'],
    reasonCodesJson: String(row['reason_codes_json']), createdAt: Number(row['created_at']),
  };
  if (sha256Hex(value.metricsJson) !== value.metricsHash) throw new Error('Stored candidate failed integrity validation.');
  return value;
}

export interface ResearchChampionRecord {
  readonly family: string; readonly candidateId: string; readonly activationId: string;
  readonly fencingGeneration: number; readonly activatedAt: number;
}

export function getResearchChampion(family: string, database: Db): ResearchChampionRecord | null {
  const row = database.prepare('SELECT * FROM research_champions_v1 WHERE family=?').get(family) as Record<string, unknown> | undefined;
  return row === undefined ? null : { family: String(row['family']), candidateId: String(row['candidate_id']),
    activationId: String(row['activation_id']), fencingGeneration: Number(row['fencing_generation']),
    activatedAt: Number(row['activated_at']) };
}

export function activateResearchCandidate(
  candidateId: string, approvalRef: string, action: 'activate' | 'rollback', at: number, database: Db,
): ResearchChampionRecord {
  if (approvalRef.trim().length < 3) throw new TypeError('Explicit human approval reference is required.');
  return inTransaction(database, () => {
    const candidate = getResearchCandidate(candidateId, database);
    if (candidate === null) throw new Error('Research candidate not found.');
    if (action === 'activate' && candidate.state !== 'promotion_eligible') throw new Error('Candidate is not promotion eligible.');
    if (action === 'rollback') {
      const priorActivation = database.prepare(`SELECT 1 FROM research_activation_history_v1
        WHERE family=? AND candidate_id=? LIMIT 1`).get(candidate.family, candidateId);
      if (priorActivation === undefined) throw new Error('Rollback target was never an active champion.');
    }
    const prior = getResearchChampion(candidate.family, database);
    const generation = (prior?.fencingGeneration ?? 0) + 1;
    const activationId = sha256Hex(['research-activation-v1', candidate.family, action,
      candidateId, prior?.candidateId ?? '', approvalRef, String(generation), String(at)].join(':'));
    database.prepare(`INSERT INTO research_activation_history_v1
      (id,family,action,candidate_id,prior_candidate_id,approval_ref,fencing_generation,at)
      VALUES (?,?,?,?,?,?,?,?)`).run(activationId, candidate.family, action, candidateId,
        prior?.candidateId ?? null, approvalRef, generation, at);
    database.prepare(`INSERT INTO research_champions_v1
      (family,candidate_id,activation_id,fencing_generation,activated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(family) DO UPDATE SET candidate_id=excluded.candidate_id,
      activation_id=excluded.activation_id,fencing_generation=excluded.fencing_generation,
      activated_at=excluded.activated_at`).run(candidate.family, candidateId, activationId, generation, at);
    return getResearchChampion(candidate.family, database)!;
  });
}

export interface ResearchTriggerRecord {
  readonly id: string; readonly family: string; readonly kind: 'scheduled' | 'event';
  readonly debounceMs: number; readonly cooldownMs: number; readonly maxDurationMs: number; readonly trialBudget: number;
  readonly trialsUsed: number; readonly lastTriggeredAt: number | null; readonly pendingSince: number | null;
  readonly updatedAt: number;
}

export function saveResearchTrigger(trigger: ResearchTriggerRecord, database: Db): void {
  database.prepare(`INSERT INTO research_triggers_v1
    (id,family,kind,debounce_ms,cooldown_ms,max_duration_ms,trial_budget,trials_used,last_triggered_at,pending_since,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    debounce_ms=excluded.debounce_ms,cooldown_ms=excluded.cooldown_ms,max_duration_ms=excluded.max_duration_ms,
    trial_budget=excluded.trial_budget,trials_used=excluded.trials_used,
    last_triggered_at=excluded.last_triggered_at,pending_since=excluded.pending_since,updated_at=excluded.updated_at`).run(
      trigger.id, trigger.family, trigger.kind, trigger.debounceMs, trigger.cooldownMs, trigger.maxDurationMs,
      trigger.trialBudget, trigger.trialsUsed, trigger.lastTriggeredAt, trigger.pendingSince, trigger.updatedAt);
}

export function getResearchTrigger(id: string, database: Db): ResearchTriggerRecord | null {
  const row = database.prepare('SELECT * FROM research_triggers_v1 WHERE id=?').get(id) as Record<string, unknown> | undefined;
  return row === undefined ? null : { id: String(row['id']), family: String(row['family']),
    kind: row['kind'] as ResearchTriggerRecord['kind'], debounceMs: Number(row['debounce_ms']), cooldownMs: Number(row['cooldown_ms']),
    maxDurationMs: Number(row['max_duration_ms']), trialBudget: Number(row['trial_budget']),
    trialsUsed: Number(row['trials_used']), lastTriggeredAt: row['last_triggered_at'] === null ? null : Number(row['last_triggered_at']),
    pendingSince: row['pending_since'] === null ? null : Number(row['pending_since']), updatedAt: Number(row['updated_at']) };
}

export function appendResearchTriggerEvent(triggerId: string, kind: 'scheduled' | 'debounced' | 'started' | 'blocked', reasonCode: string, at: number, detailJson: string, database: Db): void {
  validJson(detailJson, 'Trigger detail');
  database.prepare(`INSERT INTO research_trigger_events_v1
    (id,trigger_id,kind,reason_code,at,detail_json) VALUES (?,?,?,?,?,?)`).run(
      sha256Hex([triggerId, kind, reasonCode, String(at), detailJson].join(':')),
      triggerId, kind, reasonCode, at, detailJson);
}
