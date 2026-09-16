import { getStrategyDecision } from './decision-evidence.js';
import { getExecutionPlan, listExecutionRoutes } from './execution-routing.js';
import { currentExploratoryPaperCampaign } from './exploratory-paper.js';
import { listResearchJobs } from './research.js';
import type { Db } from '../sqlite/index.js';

export type OperationsSubsystem = 'host' | 'market' | 'risk' | 'research' | 'execution' | 'advisor';
export type OperationsState = 'nominal' | 'active' | 'attention' | 'unavailable';
export interface OperationsFloorItem {
  readonly subsystem: OperationsSubsystem;
  readonly state: OperationsState;
  readonly title: string;
  readonly detail: string;
  readonly evidenceAtMs: number | null;
  readonly evidenceId: string | null;
  readonly decisionId: string | null;
  readonly scope: 'profile' | 'global';
}

function unavailable(subsystem: OperationsSubsystem, title: string, detail: string,
  scope: 'profile' | 'global' = 'profile'): OperationsFloorItem {
  return { subsystem, state: 'unavailable', title, detail, evidenceAtMs: null,
    evidenceId: null, decisionId: null, scope };
}

/** Six fixed, bounded read models. Every populated cell cites one persisted row. */
export function readOperationsFloor(profileId: string, database: Db): readonly OperationsFloorItem[] {
  const hostRow = database.prepare(`SELECT id, kind, at FROM scheduler_lease_events_v1
    WHERE profile_id=? ORDER BY at DESC, id DESC LIMIT 1`).get(profileId) as
    { id: string; kind: 'acquired'|'renewed'|'released'|'lost'|'cancelled'; at: number } | undefined;
  const host = hostRow === undefined ? unavailable('host', 'Host coordinator', 'No persisted scheduler lease event.') : {
    subsystem: 'host' as const,
    state: hostRow.kind === 'lost' || hostRow.kind === 'cancelled' ? 'attention' as const :
      hostRow.kind === 'released' ? 'nominal' as const : 'active' as const,
    title: 'Host coordinator', detail: `Latest scheduler lease event: ${hostRow.kind}.`,
    evidenceAtMs: hostRow.at, evidenceId: hostRow.id, decisionId: null, scope: 'profile' as const,
  };

  const decisionRow = database.prepare(`SELECT decision_id FROM strategy_decisions_v1
    WHERE profile_id=? ORDER BY scheduled_for DESC, decision_id DESC LIMIT 1`).get(profileId) as
    { decision_id: string } | undefined;
  let market = unavailable('market', 'Market observer', 'No persisted strategy decision dataset.');
  if (decisionRow !== undefined) {
    try {
      const stored = getStrategyDecision(decisionRow.decision_id, database);
      if (stored !== null) {
        const value = stored.decision.market;
        const ready = value.freshness === 'fresh' && value.rulesFresh && value.snapshotHash !== null;
        market = { subsystem: 'market', state: ready ? 'nominal' : 'attention', title: 'Market observer',
          detail: ready ? 'Latest completed decision dataset and rules were fresh.' :
            `Latest decision dataset was ${value.freshness}; refresh ${value.refreshResult.replaceAll('_', ' ')}.`,
          evidenceAtMs: Math.max(value.asOfMs ?? 0, stored.decision.createdAtMs), evidenceId: stored.contentHash,
          decisionId: stored.decision.decisionId, scope: 'profile' };
      }
    } catch {
      market = { ...market, state: 'attention', detail: 'Latest decision evidence failed integrity verification.' };
    }
  }
  const exploratory = currentExploratoryPaperCampaign(profileId, database);
  if (exploratory?.status === 'active' &&
      (market.evidenceAtMs === null || market.evidenceAtMs < exploratory.campaign.startedAtMs)) {
    market = {
      subsystem: 'market', state: 'active', title: 'Market observer',
      detail: 'Exploratory paper is active; awaiting its first completed-bar evaluation.',
      evidenceAtMs: exploratory.campaign.startedAtMs, evidenceId: exploratory.campaign.contentHash,
      decisionId: null, scope: 'profile',
    };
  }

  const riskRow = database.prepare(`SELECT id, decision_id, at, payload_json FROM decision_evidence_events_v1
    WHERE profile_id=? AND kind='risk_evaluated' ORDER BY at DESC, id DESC LIMIT 1`).get(profileId) as
    { id: string; decision_id: string; at: number; payload_json: string } | undefined;
  let risk = unavailable('risk', 'Risk sentinel', 'No persisted risk evaluation.');
  if (riskRow !== undefined) {
    try {
      const payload = JSON.parse(riskRow.payload_json) as { detail?: { approved?: unknown; reasonCodes?: unknown } };
      const approved = payload.detail?.approved === true;
      const reasons = Array.isArray(payload.detail?.reasonCodes) ? payload.detail.reasonCodes
        .filter((value): value is string => typeof value === 'string').slice(0, 4) : [];
      risk = { subsystem: 'risk', state: approved ? 'nominal' : 'attention', title: 'Risk sentinel',
        detail: approved ? 'Latest persisted risk assessment approved paper planning.' :
          `Latest risk assessment refused planning${reasons.length === 0 ? '.' : `: ${reasons.join(', ')}.`}`,
        evidenceAtMs: riskRow.at, evidenceId: riskRow.id, decisionId: riskRow.decision_id, scope: 'profile' };
    } catch { risk = { ...risk, state: 'attention', detail: 'Latest risk evidence could not be decoded.' }; }
  }

  const jobs = listResearchJobs(database, 1);
  const job = jobs[0];
  const research = job === undefined ? unavailable('research', 'Research lab',
    'No persisted worker job.', 'global') : {
    subsystem: 'research' as const,
    state: job.status === 'failed' || job.status === 'cancelled' ? 'attention' as const :
      job.status === 'queued' || job.status === 'running' ? 'active' as const : 'nominal' as const,
    title: 'Research lab', detail: `Latest ${job.kind} job is ${job.status}.`,
    evidenceAtMs: job.completedAt ?? job.startedAt ?? job.createdAt, evidenceId: job.resultHash ?? job.snapshotHash ?? job.id,
    decisionId: null, scope: 'global' as const,
  };

  const routeRow = database.prepare(`SELECT id, plan_id, decision_id, provider, created_at
    FROM execution_routes_v1 WHERE profile_id=? ORDER BY created_at DESC, id DESC LIMIT 1`).get(profileId) as
    { id: string; plan_id: string; decision_id: string; provider: string; created_at: number } | undefined;
  let routing = unavailable('execution', 'Route and paper execution', 'No persisted execution route.');
  if (routeRow !== undefined) {
    try {
      const plan = getExecutionPlan(routeRow.plan_id, profileId, database);
      const verified = plan !== null && listExecutionRoutes(plan.id, profileId, database)
        .some((route) => route.id === routeRow.id);
      routing = { subsystem: 'execution', state: verified ? 'nominal' : 'attention', title: 'Route and paper execution',
        detail: verified ? `Latest immutable route targets the ${routeRow.provider} paper venue.` :
          'Latest route failed integrity verification.', evidenceAtMs: routeRow.created_at,
        evidenceId: routeRow.id, decisionId: routeRow.decision_id, scope: 'profile' };
    } catch {
      routing = { subsystem: 'execution', state: 'attention', title: 'Route and paper execution',
        detail: 'Latest route failed integrity verification.', evidenceAtMs: routeRow.created_at,
        evidenceId: routeRow.id, decisionId: routeRow.decision_id, scope: 'profile' };
    }
  }

  const executionRow = database.prepare(`SELECT id, decision_id, kind, reason_code, at
    FROM decision_evidence_events_v1 WHERE profile_id=? AND kind IN
      ('execution_submitted','execution_filled','execution_refused','recovery')
    ORDER BY at DESC, id DESC LIMIT 1`).get(profileId) as
    { id: string; decision_id: string; kind: string; reason_code: string | null; at: number } | undefined;
  const execution = executionRow === undefined ? unavailable('execution', 'Route and paper execution',
    'No persisted execution outcome.') : {
    subsystem: 'execution' as const,
    state: executionRow.kind === 'execution_refused' ? 'attention' as const :
      executionRow.kind === 'execution_submitted' ? 'active' as const : 'nominal' as const,
    title: 'Route and paper execution', detail: executionRow.reason_code === null
      ? `Latest execution evidence: ${executionRow.kind.replaceAll('_', ' ')}.`
      : `Latest execution evidence: ${executionRow.reason_code.replaceAll('_', ' ')}.`,
    evidenceAtMs: executionRow.at, evidenceId: executionRow.id,
    decisionId: executionRow.decision_id, scope: 'profile' as const,
  };
  const courier = routing.evidenceAtMs !== null &&
    (execution.evidenceAtMs === null || routing.evidenceAtMs > execution.evidenceAtMs) ? routing : execution;
  const navigation = database.prepare(`SELECT id,outcome,target,at FROM advisor_navigation_audit_events_v1
    WHERE profile_id=? ORDER BY at DESC,id DESC LIMIT 1`).get(profileId) as
    { id: string; outcome: 'accepted' | 'rejected'; target: string; at: number } | undefined;
  const generation = database.prepare(`SELECT sequence,provider,operation,outcome,occurred_at_ms FROM advisor_audit_events_v1
    WHERE profile_id=? ORDER BY occurred_at_ms DESC,sequence DESC LIMIT 1`).get(profileId) as
    { sequence: number; provider: string; operation: string;
      outcome: 'succeeded' | 'failed' | 'cancelled'; occurred_at_ms: number } | undefined;
  let advisor = unavailable('advisor', 'Evidence advisor', 'No persisted explanation or navigation event.');
  if (generation !== undefined && (navigation === undefined || generation.occurred_at_ms > navigation.at)) {
    advisor = { subsystem: 'advisor', state: generation.outcome === 'succeeded' ? 'nominal' : 'attention',
      title: 'Evidence advisor', detail: `Latest ${generation.provider} ${generation.operation} request ${generation.outcome}.`,
      evidenceAtMs: generation.occurred_at_ms, evidenceId: `advisor-audit:${generation.sequence}`,
      decisionId: null, scope: 'profile' };
  } else if (navigation !== undefined) {
    advisor = { subsystem: 'advisor', state: navigation.outcome === 'accepted' ? 'nominal' : 'attention',
      title: 'Evidence advisor', detail: `Latest navigation to ${navigation.target} was ${navigation.outcome}.`,
      evidenceAtMs: navigation.at, evidenceId: navigation.id, decisionId: null, scope: 'profile' };
  }
  return Object.freeze([host, market, risk, research, courier, advisor]);
}
