import {
  hashForwardEdgePlan,
  nonNegativeDecimal,
  sha256Hex,
  type ForwardEdgeStudyPlan,
  type ForwardEdgeStudyResult,
  type ProfitabilityEstimateEvidence,
} from '@coqui/core';

import type { Db } from '../sqlite/index.js';

const DAY_MS = 86_400_000;

export interface ForwardEdgeObservationRecord {
  readonly id: string;
  readonly planHash: string;
  readonly profileId: string;
  readonly dayUtc: number;
  readonly runId: string;
  readonly observedAt: number;
  readonly actualEquityUsd: string | null;
  readonly holdEquityUsd: string | null;
  readonly noTradeEquityUsd: string | null;
  readonly turnoverUsd: string;
  readonly recordedCostUsd: string;
  readonly marketPricesJson: string;
  readonly valuationComplete: boolean;
  readonly stateHash: string;
  readonly provenanceJson: string;
  readonly evidenceHash: string;
}

export interface PaperCampaignStatus {
  readonly id: string;
  readonly kind: 'zero_edge_stand_down' | 'validated_unattended';
  readonly startDayUtc: number;
  readonly requiredDays: 7;
  readonly observedDays: number;
  readonly killSwitchExercised: boolean;
  readonly killSwitchAcknowledged: boolean;
  readonly reconciled: boolean;
  readonly state: 'registered' | 'running' | 'completed' | 'failed';
}

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

interface ObservationRow {
  id: string; plan_hash: string; profile_id: string; day_utc: number; run_id: string;
  observed_at: number; actual_equity_usd_text: string | null; hold_equity_usd_text: string | null;
  no_trade_equity_usd_text: string | null; turnover_usd_text: string;
  recorded_cost_usd_text: string; market_prices_json: string; valuation_complete: number;
  state_hash: string; provenance_json: string; evidence_hash: string;
}

function observationFromRow(row: ObservationRow): ForwardEdgeObservationRecord {
  return Object.freeze({
    id: row.id, planHash: row.plan_hash, profileId: row.profile_id, dayUtc: row.day_utc,
    runId: row.run_id, observedAt: row.observed_at,
    actualEquityUsd: row.actual_equity_usd_text, holdEquityUsd: row.hold_equity_usd_text,
    noTradeEquityUsd: row.no_trade_equity_usd_text, turnoverUsd: row.turnover_usd_text,
    recordedCostUsd: row.recorded_cost_usd_text, marketPricesJson: row.market_prices_json,
    valuationComplete: row.valuation_complete === 1, stateHash: row.state_hash,
    provenanceJson: row.provenance_json, evidenceHash: row.evidence_hash,
  });
}

export function saveForwardEdgeObservation(
  observation: ForwardEdgeObservationRecord,
  database: Db,
): boolean {
  for (const value of [observation.turnoverUsd, observation.recordedCostUsd,
    observation.actualEquityUsd, observation.holdEquityUsd, observation.noTradeEquityUsd]) {
    if (value !== null) nonNegativeDecimal(value);
  }
  JSON.parse(observation.marketPricesJson) as unknown;
  JSON.parse(observation.provenanceJson) as unknown;
  const prior = database.prepare(`SELECT * FROM forward_edge_observations_v1
    WHERE plan_hash = ? AND profile_id = ? AND day_utc = ?`)
    .get(observation.planHash, observation.profileId, observation.dayUtc) as
      unknown as ObservationRow | undefined;
  if (prior !== undefined) {
    if (JSON.stringify(observationFromRow(prior)) !== JSON.stringify(observation)) {
      throw new Error('Forward edge observation cannot be replaced.');
    }
    return false;
  }
  return database.prepare(`INSERT INTO forward_edge_observations_v1
    (id, plan_hash, profile_id, day_utc, run_id, observed_at, actual_equity_usd_text,
      hold_equity_usd_text, no_trade_equity_usd_text, turnover_usd_text,
      recorded_cost_usd_text, market_prices_json, valuation_complete, state_hash,
      provenance_json, evidence_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(observation.id, observation.planHash, observation.profileId, observation.dayUtc,
    observation.runId, observation.observedAt, observation.actualEquityUsd,
    observation.holdEquityUsd, observation.noTradeEquityUsd, observation.turnoverUsd,
    observation.recordedCostUsd, observation.marketPricesJson,
    observation.valuationComplete ? 1 : 0, observation.stateHash,
    observation.provenanceJson, observation.evidenceHash).changes === 1;
}

export function listForwardEdgeObservations(
  planHash: string,
  profileId: string,
  database: Db,
): readonly ForwardEdgeObservationRecord[] {
  const rows = database.prepare(`SELECT * FROM forward_edge_observations_v1
    WHERE plan_hash = ? AND profile_id = ? ORDER BY day_utc, id`)
    .all(planHash, profileId) as unknown as ObservationRow[];
  return Object.freeze(rows.map(observationFromRow));
}

export function ensurePaperCampaign(input: {
  readonly profileId: string;
  readonly kind: PaperCampaignStatus['kind'];
  readonly startDayUtc: number;
  readonly registeredAt: number;
}, database: Db): PaperCampaignStatus {
  const planHash = sha256Hex(JSON.stringify({ ...input, requiredDays: 7 }));
  const id = sha256Hex(`paper-campaign:${planHash}`);
  database.prepare(`INSERT OR IGNORE INTO paper_campaign_plans_v1
    (id, profile_id, kind, start_day_utc, required_days, registered_at, plan_hash)
    VALUES (?, ?, ?, ?, 7, ?, ?)`
  ).run(id, input.profileId, input.kind, input.startDayUtc, input.registeredAt, planHash);
  return readPaperCampaign(id, database)!;
}

export function appendPaperCampaignEvent(input: {
  readonly campaignId: string; readonly dayUtc: number; readonly runId: string;
  readonly status: 'observed' | 'kill_switch_exercised' | 'kill_switch_acknowledged' |
    'reconciled' | 'failed';
  readonly at: number; readonly detail: Record<string, unknown>;
}, database: Db): boolean {
  const detailJson = JSON.stringify(input.detail);
  const evidenceHash = sha256Hex(JSON.stringify({ ...input, detail: input.detail }));
  const id = sha256Hex(`paper-campaign-event:${input.campaignId}:${input.status}:${input.dayUtc}:${input.runId}`);
  return database.prepare(`INSERT OR IGNORE INTO paper_campaign_events_v1
    (id, campaign_id, day_utc, run_id, status, at, evidence_hash, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.campaignId, input.dayUtc, input.runId, input.status, input.at,
    evidenceHash, detailJson).changes === 1;
}

export function readPaperCampaign(id: string, database: Db): PaperCampaignStatus | null {
  const plan = database.prepare('SELECT * FROM paper_campaign_plans_v1 WHERE id = ?').get(id) as
    unknown as { id: string; kind: PaperCampaignStatus['kind']; start_day_utc: number;
      required_days: 7 } | undefined;
  if (plan === undefined) return null;
  const rows = database.prepare(`SELECT day_utc, status FROM paper_campaign_events_v1
    WHERE campaign_id = ? ORDER BY day_utc, at, id`).all(id) as unknown as
      Array<{ day_utc: number; status: string }>;
  const observed = new Set(rows.filter((row) => row.status === 'observed' &&
    row.day_utc >= plan.start_day_utc && row.day_utc < plan.start_day_utc + 7 * DAY_MS)
    .map((row) => row.day_utc));
  const failed = rows.some((row) => row.status === 'failed');
  const killSwitchExercised = rows.some((row) => row.status === 'kill_switch_exercised');
  const killSwitchAcknowledged = rows.some((row) => row.status === 'kill_switch_acknowledged');
  const reconciled = rows.some((row) => row.status === 'reconciled');
  const completed = observed.size === 7 && killSwitchExercised && killSwitchAcknowledged && reconciled;
  return Object.freeze({
    id: plan.id, kind: plan.kind, startDayUtc: plan.start_day_utc, requiredDays: 7,
    observedDays: observed.size, killSwitchExercised, killSwitchAcknowledged, reconciled,
    state: failed ? 'failed' : completed ? 'completed' : observed.size > 0 ? 'running' : 'registered',
  });
}

export function latestPaperCampaign(profileId: string, database: Db): PaperCampaignStatus | null {
  const row = database.prepare(`SELECT id FROM paper_campaign_plans_v1
    WHERE profile_id = ? ORDER BY registered_at DESC, id DESC LIMIT 1`)
    .get(profileId) as { id: string } | undefined;
  return row === undefined ? null : readPaperCampaign(row.id, database);
}
