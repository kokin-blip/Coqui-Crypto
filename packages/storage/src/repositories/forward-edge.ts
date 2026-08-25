import {
  hashForwardEdgePlan,
  sha256Hex,
  type ForwardEdgeStudyPlan,
  type ForwardEdgeStudyResult,
  type ProfitabilityEstimateEvidence,
} from '@coqui/core';

import type { Db } from '../sqlite/index.js';

export interface ForwardEdgeStudyStatus {
  readonly plan: ForwardEdgeStudyPlan | null;
  readonly planHash: string | null;
  readonly result: ForwardEdgeStudyResult | null;
  readonly resultHash: string | null;
  readonly activated: boolean;
}

export function registerForwardEdgeStudy(plan: ForwardEdgeStudyPlan, db: Db): string {
  const planHash = hashForwardEdgePlan(plan);
  const planJson = JSON.stringify(plan);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT OR IGNORE INTO forward_edge_study_plans_v1
      (plan_hash, registered_at, code_revision, cost_profile_hash, plan_json)
      VALUES (?, ?, ?, ?, ?)`
    ).run(planHash, plan.registeredAtMs, plan.codeRevision, plan.costProfileHash, planJson);
    const stored = db.prepare('SELECT plan_json FROM forward_edge_study_plans_v1 WHERE plan_hash = ?')
      .get(planHash) as { plan_json: string } | undefined;
    if (stored?.plan_json !== planJson) throw new Error('forward_edge_plan_integrity_mismatch');
    db.prepare(`INSERT OR IGNORE INTO forward_edge_status_events_v1
      (id, plan_hash, at, status, evidence_hash, details_json) VALUES (?, ?, ?, 'registered', ?, '{}')`
    ).run(sha256Hex(`forward-edge:registered:${planHash}`), planHash, plan.registeredAtMs, planHash);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return planHash;
}

export function readForwardEdgeStudyStatus(db: Db): ForwardEdgeStudyStatus {
  const plan = db.prepare(`SELECT plan_hash, plan_json FROM forward_edge_study_plans_v1
    ORDER BY registered_at DESC LIMIT 1`).get() as { plan_hash: string; plan_json: string } | undefined;
  if (plan === undefined) return { plan: null, planHash: null, result: null, resultHash: null, activated: false };
  const parsedPlan = JSON.parse(plan.plan_json) as ForwardEdgeStudyPlan;
  if (hashForwardEdgePlan(parsedPlan) !== plan.plan_hash) throw new Error('forward_edge_plan_integrity_mismatch');
  const result = db.prepare(`SELECT result_hash, result_json FROM forward_edge_study_results_v1
    WHERE plan_hash = ? ORDER BY completed_at DESC LIMIT 1`).get(plan.plan_hash) as
      { result_hash: string; result_json: string } | undefined;
  return Object.freeze({
    plan: parsedPlan,
    planHash: plan.plan_hash,
    result: result === undefined ? null : JSON.parse(result.result_json) as ForwardEdgeStudyResult,
    resultHash: result?.result_hash ?? null,
    activated: result === undefined ? false : (db.prepare(
      'SELECT 1 AS found FROM profitability_estimate_evidence_v1 WHERE result_hash = ? LIMIT 1',
    ).get(result.result_hash) as { found: number } | undefined) !== undefined,
  });
}

export function recordForwardEdgeStudyResult(
  result: ForwardEdgeStudyResult,
  completedAt: number,
  integrityVerified: boolean,
  db: Db,
): string {
  const resultJson = JSON.stringify(result);
  const resultHash = sha256Hex(resultJson);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT OR IGNORE INTO forward_edge_study_results_v1
      (result_hash, plan_hash, completed_at, passed, integrity_verified,
        gross_edge_lower_bound_pct_text, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(resultHash, result.planHash, completedAt, result.outcome === 'passed' ? 1 : 0,
      integrityVerified ? 1 : 0, String(result.grossEdgeLowerConfidenceBoundPct ?? 0), resultJson);
    const stored = db.prepare('SELECT result_json FROM forward_edge_study_results_v1 WHERE result_hash = ?')
      .get(resultHash) as { result_json: string } | undefined;
    if (stored?.result_json !== resultJson) throw new Error('forward_edge_result_integrity_mismatch');
    const status = result.outcome === 'incomplete' ? 'ready' : result.outcome;
    db.prepare(`INSERT OR IGNORE INTO forward_edge_status_events_v1
      (id, plan_hash, at, status, evidence_hash, details_json) VALUES (?, ?, ?, ?, ?, '{}')`
    ).run(sha256Hex(`forward-edge:${status}:${resultHash}`), result.planHash, completedAt,
      status, resultHash);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return resultHash;
}

export function activateProfitabilityEstimate(input: {
  readonly profileId: string; readonly resultHash: string; readonly commandId: string;
  readonly activatedAt: number;
}, db: Db): ProfitabilityEstimateEvidence {
  const row = db.prepare(`SELECT passed, integrity_verified, gross_edge_lower_bound_pct_text,
      result_json FROM forward_edge_study_results_v1 WHERE result_hash = ?`).get(input.resultHash) as {
      passed: number; integrity_verified: number; gross_edge_lower_bound_pct_text: string;
      result_json: string;
    } | undefined;
  if (row === undefined || row.passed !== 1 || row.integrity_verified !== 1) {
    throw new Error('forward_edge_result_not_eligible');
  }
  const result = JSON.parse(row.result_json) as ForwardEdgeStudyResult;
  if (result.outcome !== 'passed' || sha256Hex(row.result_json) !== input.resultHash ||
      result.grossEdgeLowerConfidenceBoundPct === null || result.grossEdgeLowerConfidenceBoundPct <= 0) {
    throw new Error('forward_edge_result_integrity_mismatch');
  }
  const sourceHashesJson = JSON.stringify(result.sourceHashes);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT OR IGNORE INTO profitability_estimate_evidence_v1
      (id, profile_id, result_hash, gross_edge_lower_bound_pct_text, source_hashes_json,
        activated_at, command_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(sha256Hex(`profitability:${input.commandId}`), input.profileId, input.resultHash,
      String(result.grossEdgeLowerConfidenceBoundPct), sourceHashesJson, input.activatedAt,
      input.commandId);
    const durable = db.prepare(`SELECT profile_id, result_hash FROM profitability_estimate_evidence_v1
      WHERE command_id = ?`).get(input.commandId) as
        { profile_id: string; result_hash: string } | undefined;
    if (durable?.profile_id !== input.profileId || durable.result_hash !== input.resultHash) {
      throw new Error('profitability_activation_command_conflict');
    }
    db.prepare(`INSERT OR IGNORE INTO forward_edge_status_events_v1
      (id, plan_hash, at, status, evidence_hash, details_json)
      VALUES (?, ?, ?, 'activated', ?, ?)`
    ).run(sha256Hex(`forward-edge:activated:${input.profileId}:${input.commandId}`), result.planHash,
      input.activatedAt, input.resultHash, JSON.stringify({ profileId: input.profileId }));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return Object.freeze({ grossEdgeLowerBoundPct: result.grossEdgeLowerConfidenceBoundPct,
    resultHash: input.resultHash, sourceHashes: result.sourceHashes, integrityVerified: true });
}

/** Manual settings are intentionally absent: only immutable passing evidence can reach execution. */
export function readProfitabilityEstimateEvidence(
  profileId: string,
  db: Db,
): ProfitabilityEstimateEvidence | null {
  const row = db.prepare(`SELECT e.gross_edge_lower_bound_pct_text, e.result_hash,
      e.source_hashes_json, r.passed, r.integrity_verified
    FROM profitability_estimate_evidence_v1 e
    JOIN forward_edge_study_results_v1 r ON r.result_hash = e.result_hash
    WHERE e.profile_id = ? ORDER BY e.activated_at DESC LIMIT 1`).get(profileId) as {
      gross_edge_lower_bound_pct_text: string; result_hash: string; source_hashes_json: string;
      passed: number; integrity_verified: number;
    } | undefined;
  if (row === undefined || row.passed !== 1 || row.integrity_verified !== 1) return null;
  const value = Number(row.gross_edge_lower_bound_pct_text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Object.freeze({
    grossEdgeLowerBoundPct: value,
    resultHash: row.result_hash,
    sourceHashes: JSON.parse(row.source_hashes_json) as string[],
    integrityVerified: true,
  });
}
