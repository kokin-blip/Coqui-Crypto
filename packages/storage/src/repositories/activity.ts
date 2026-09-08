import type { Db } from '../sqlite/index.js';
import { listExtendedActivityEvents } from './activity-extended.js';

interface DecisionRow { id: string; scheduled_for: number; status: string; strategy_version: string; snapshot_hash: string }
interface EvidenceRow { id: string; decision_id: string; at: number; kind: string; reason_code: string | null; payload_hash: string; asset_scopes: string }
interface PaperRow { id: string; at: number; kind: string; proposal_id: string; decision_id: string | null }
interface FillRow { id: string; filled_at: number; quantity_text: string; notional_text: string; venue_fee_text: string; market_snapshot_hash: string; product_id: string; side: string; decision_id: string | null }
interface AlertRow { id: string; occurred_at: number; kind: string; severity: string; reason_code: string; evidence_hash: string }
interface IncidentRow { id: string; occurred_at: number; kind: string; severity: string; source: string; resolved_at: number | null }

const HISTORICALLY_MISLABELED_STRATEGY = 'trendvol-legacy-unvalidated';

function decisionStrategyLabel(strategyVersion: string): string {
  return strategyVersion === HISTORICALLY_MISLABELED_STRATEGY
    ? 'legacy allocation rebalancer (historically mislabeled as TrendVol)'
    : strategyVersion;
}

export interface ActivityFeedEvent {
  readonly id: string;
  readonly kind: 'decision' | 'market' | 'risk' | 'research' | 'routing' | 'paper' | 'fill' | 'alert' | 'reconciliation' | 'failure' | 'host';
  readonly status: 'info' | 'pending' | 'succeeded' | 'blocked' | 'failed' | 'unknown';
  readonly title: string;
  readonly detail: string;
  readonly occurredAt: number;
  readonly provenance: string | null;
  readonly decisionId: string | null;
  readonly evidenceId: string | null;
  readonly reasonCode: string | null;
  readonly assetScopes: readonly string[];
}

function cursorFor(event: ActivityFeedEvent): string {
  return `${event.occurredAt}:${event.id}`;
}

function beforeCursor(event: ActivityFeedEvent, cursor: string | null): boolean {
  if (cursor === null) return true;
  const separator = cursor.indexOf(':');
  const at = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!Number.isSafeInteger(at) || id.length === 0) return false;
  return event.occurredAt < at || (event.occurredAt === at && event.id < id);
}

/** A bounded, read-only merge. Details are selected fields, never raw error JSON. */
export function listActivityFeed(
  profileId: string,
  limit: number,
  cursor: string | null,
  database: Db,
): { readonly events: readonly ActivityFeedEvent[]; readonly nextCursor: string | null } {
  const perSource = Math.min(201, limit + 1);
  const decisionRows = database.prepare(`
    SELECT wallet.id, wallet.scheduled_for, wallet.status, wallet.strategy_version, wallet.snapshot_hash
    FROM wallet_decision_runs wallet
    LEFT JOIN wallet_decision_links_v1 link ON link.run_id = wallet.id
    WHERE wallet.profile_id = ? AND link.run_id IS NULL
    ORDER BY wallet.scheduled_for DESC, wallet.id DESC LIMIT ?
  `).all(profileId, perSource) as unknown as DecisionRow[];
  const evidenceRows = database.prepare(`
    SELECT event.id,event.decision_id,event.at,event.kind,event.reason_code,event.payload_hash,
      GROUP_CONCAT(link.asset_scope) AS asset_scopes
    FROM decision_evidence_events_v1 event
    JOIN decision_evidence_asset_links_v1 link ON link.event_id=event.id
    WHERE event.profile_id = ? GROUP BY event.id
    ORDER BY event.at DESC,event.id DESC LIMIT ?
  `).all(profileId, perSource) as unknown as EvidenceRow[];
  const paperRows = database.prepare(`
    SELECT event.id, event.at, event.kind, event.proposal_id, context.decision_id
    FROM paper_execution_events_v1 event
    LEFT JOIN paper_proposal_pending_context_v1 context ON context.proposal_id = event.proposal_id
    WHERE event.profile_id = ? ORDER BY event.at DESC, event.id DESC LIMIT ?
  `).all(profileId, perSource) as unknown as PaperRow[];
  const fillRows = database.prepare(`
    SELECT f.id, f.filled_at, f.quantity_text, f.notional_text, f.venue_fee_text,
           f.market_snapshot_hash, o.product_id, o.side, pending.decision_id
    FROM paper_fills_v3 f JOIN paper_orders_v3 o ON o.id = f.order_id
    LEFT JOIN paper_pending_executions_v1 pending ON pending.order_id = o.id
    WHERE f.profile_id = ? ORDER BY f.filled_at DESC, f.id DESC LIMIT ?
  `).all(profileId, perSource) as unknown as FillRow[];
  const alertRows = database.prepare(`
    SELECT id, occurred_at, kind, severity, reason_code, evidence_hash
    FROM alert_events_v2 WHERE profile_id = ?
    ORDER BY occurred_at DESC, id DESC LIMIT ?
  `).all(profileId, perSource) as unknown as AlertRow[];
  const incidentRows = database.prepare(`
    SELECT id, occurred_at, kind, severity, source, resolved_at
    FROM runtime_incidents WHERE profile_id = ?
    ORDER BY occurred_at DESC, id DESC LIMIT ?
  `).all(profileId, perSource) as unknown as IncidentRow[];

  const events: ActivityFeedEvent[] = [
    ...listExtendedActivityEvents(profileId, perSource, database),
    ...evidenceRows.map((row): ActivityFeedEvent => {
      const kind = row.kind === 'risk_evaluated' ? 'risk' as const :
        row.kind === 'execution_planned' ? 'routing' as const :
          row.kind === 'execution_submitted' || row.kind === 'execution_refused' ? 'paper' as const :
            row.kind === 'execution_filled' ? 'fill' as const :
              row.kind === 'recovery' ? 'reconciliation' as const : 'decision' as const;
      const status = row.kind === 'execution_submitted' ? 'pending' as const :
        row.kind === 'stand_down' || row.kind === 'no_trade' || row.kind === 'execution_refused' ? 'blocked' as const :
          'succeeded' as const;
      const title: Readonly<Record<string, string>> = {
        strategy_evaluated: 'Strategy evaluated', risk_evaluated: 'Risk evaluated',
        execution_planned: 'Execution plan recorded', no_trade: 'No trade',
        stand_down: 'Strategy stood down', execution_submitted: 'Paper orders submitted',
        execution_filled: 'Paper settlement recorded', execution_refused: 'Execution refused',
        recovery: 'Execution recovery recorded',
      };
      return { id: `evidence:${row.id}`, kind, status,
        title: title[row.kind] ?? 'Decision evidence recorded',
        detail: row.reason_code === null ? `${row.kind.replaceAll('_', ' ')} is part of the immutable decision trace.` :
          `Reason ${row.reason_code.replaceAll('_', ' ')}.`, occurredAt: Number(row.at),
        provenance: row.payload_hash, decisionId: row.decision_id,
        evidenceId: row.id, reasonCode: row.reason_code,
        assetScopes: Object.freeze(row.asset_scopes.split(',').sort()) };
    }),
    ...decisionRows.map((row): ActivityFeedEvent => ({
      id: `decision:${String(row.id)}`, kind: 'decision',
      status: row.status === 'completed' ? 'succeeded' : row.status === 'failed' ? 'failed' : 'pending',
      title: `Scheduled decision ${String(row.status)}`,
      detail: `Strategy ${decisionStrategyLabel(String(row.strategy_version))} evaluated its registered decision snapshot.`,
      occurredAt: Number(row.scheduled_for), provenance: String(row.snapshot_hash),
      decisionId: null, evidenceId: null, reasonCode: null,
      assetScopes: Object.freeze(['GLOBAL']),
    })),
    ...paperRows.map((row): ActivityFeedEvent => ({
      id: `paper:${String(row.id)}`, kind: 'paper',
      status: row.kind === 'succeeded' ? 'succeeded' : row.kind === 'blocked' ? 'blocked'
        : row.kind === 'failed' ? 'failed' : row.kind === 'unknown' ? 'unknown' : 'pending',
      title: `Paper execution ${String(row.kind).replaceAll('_', ' ')}`,
      detail: `Proposal ${String(row.proposal_id).slice(0, 12)} recorded an immutable execution event.`,
      occurredAt: Number(row.at), provenance: String(row.proposal_id),
      decisionId: row.decision_id, evidenceId: null, reasonCode: null,
      assetScopes: Object.freeze(['GLOBAL']),
    })),
    ...fillRows.map((row): ActivityFeedEvent => ({
      id: `fill:${String(row.id)}`, kind: 'fill', status: 'succeeded',
      title: `Paper fill · ${String(row.side).toUpperCase()} ${String(row.product_id)}`,
      detail: `${String(row.quantity_text)} units · ${String(row.notional_text)} USD notional · ${String(row.venue_fee_text)} USD fee.`,
      occurredAt: Number(row.filled_at), provenance: String(row.market_snapshot_hash),
      decisionId: row.decision_id, evidenceId: null, reasonCode: null,
      assetScopes: Object.freeze([String(row.product_id).split('-')[0]!.toUpperCase()]),
    })),
    ...alertRows.map((row): ActivityFeedEvent => ({
      id: `alert:${String(row.id)}`, kind: 'alert',
      status: row.severity === 'warn' ? 'blocked' : 'info',
      title: `Alert · ${String(row.kind).replaceAll('_', ' ')}`,
      detail: `Reason ${String(row.reason_code).replaceAll('_', ' ')}.`,
      occurredAt: Number(row.occurred_at), provenance: String(row.evidence_hash),
      decisionId: null, evidenceId: row.id, reasonCode: row.reason_code,
      assetScopes: Object.freeze(['GLOBAL']),
    })),
    ...incidentRows.map((row): ActivityFeedEvent => ({
      id: `incident:${String(row.id)}`,
      kind: row.kind === 'reconciliation' ? 'reconciliation' : 'failure',
      status: row.resolved_at === null ? 'failed' : 'info',
      title: `${row.resolved_at === null ? 'Open' : 'Resolved'} ${String(row.kind).replaceAll('_', ' ')}`,
      detail: `Source ${String(row.source)} · severity ${String(row.severity)}.`,
      occurredAt: Number(row.occurred_at), provenance: null,
      decisionId: null, evidenceId: row.id, reasonCode: null,
      assetScopes: Object.freeze(['GLOBAL']),
    })),
  ];
  const ordered = events.filter((event) => beforeCursor(event, cursor))
    .sort((left, right) => right.occurredAt - left.occurredAt || right.id.localeCompare(left.id));
  const page = ordered.slice(0, limit);
  return {
    events: page,
    nextCursor: ordered.length > limit && page.length > 0 ? cursorFor(page.at(-1)!) : null,
  };
}
