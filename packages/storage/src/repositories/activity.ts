import type { Db } from '../sqlite/index.js';

interface DecisionRow { id: string; scheduled_for: number; status: string; strategy_version: string; snapshot_hash: string }
interface PaperRow { id: string; at: number; kind: string; proposal_id: string }
interface FillRow { id: string; filled_at: number; quantity_text: string; notional_text: string; venue_fee_text: string; market_snapshot_hash: string; product_id: string; side: string }
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
  readonly kind: 'decision' | 'paper' | 'fill' | 'alert' | 'reconciliation' | 'failure';
  readonly status: 'info' | 'pending' | 'succeeded' | 'blocked' | 'failed' | 'unknown';
  readonly title: string;
  readonly detail: string;
  readonly occurredAt: number;
  readonly provenance: string | null;
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
    SELECT id, scheduled_for, status, strategy_version, snapshot_hash
    FROM wallet_decision_runs WHERE profile_id = ?
    ORDER BY scheduled_for DESC, id DESC LIMIT ?
  `).all(profileId, perSource) as unknown as DecisionRow[];
  const paperRows = database.prepare(`
    SELECT id, at, kind, proposal_id FROM paper_execution_events_v1
    WHERE profile_id = ? ORDER BY at DESC, id DESC LIMIT ?
  `).all(profileId, perSource) as unknown as PaperRow[];
  const fillRows = database.prepare(`
    SELECT f.id, f.filled_at, f.quantity_text, f.notional_text, f.venue_fee_text,
           f.market_snapshot_hash, o.product_id, o.side
    FROM paper_fills_v3 f JOIN paper_orders_v3 o ON o.id = f.order_id
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
    ...decisionRows.map((row): ActivityFeedEvent => ({
      id: `decision:${String(row.id)}`, kind: 'decision',
      status: row.status === 'completed' ? 'succeeded' : row.status === 'failed' ? 'failed' : 'pending',
      title: `Scheduled decision ${String(row.status)}`,
      detail: `Strategy ${decisionStrategyLabel(String(row.strategy_version))} evaluated its registered decision snapshot.`,
      occurredAt: Number(row.scheduled_for), provenance: String(row.snapshot_hash),
    })),
    ...paperRows.map((row): ActivityFeedEvent => ({
      id: `paper:${String(row.id)}`, kind: 'paper',
      status: row.kind === 'succeeded' ? 'succeeded' : row.kind === 'blocked' ? 'blocked'
        : row.kind === 'failed' ? 'failed' : row.kind === 'unknown' ? 'unknown' : 'pending',
      title: `Paper execution ${String(row.kind).replaceAll('_', ' ')}`,
      detail: `Proposal ${String(row.proposal_id).slice(0, 12)} recorded an immutable execution event.`,
      occurredAt: Number(row.at), provenance: String(row.proposal_id),
    })),
    ...fillRows.map((row): ActivityFeedEvent => ({
      id: `fill:${String(row.id)}`, kind: 'fill', status: 'succeeded',
      title: `Paper fill · ${String(row.side).toUpperCase()} ${String(row.product_id)}`,
      detail: `${String(row.quantity_text)} units · ${String(row.notional_text)} USD notional · ${String(row.venue_fee_text)} USD fee.`,
      occurredAt: Number(row.filled_at), provenance: String(row.market_snapshot_hash),
    })),
    ...alertRows.map((row): ActivityFeedEvent => ({
      id: `alert:${String(row.id)}`, kind: 'alert',
      status: row.severity === 'warn' ? 'blocked' : 'info',
      title: `Alert · ${String(row.kind).replaceAll('_', ' ')}`,
      detail: `Reason ${String(row.reason_code).replaceAll('_', ' ')}.`,
      occurredAt: Number(row.occurred_at), provenance: String(row.evidence_hash),
    })),
    ...incidentRows.map((row): ActivityFeedEvent => ({
      id: `incident:${String(row.id)}`,
      kind: row.kind === 'reconciliation' ? 'reconciliation' : 'failure',
      status: row.resolved_at === null ? 'failed' : 'info',
      title: `${row.resolved_at === null ? 'Open' : 'Resolved'} ${String(row.kind).replaceAll('_', ' ')}`,
      detail: `Source ${String(row.source)} · severity ${String(row.severity)}.`,
      occurredAt: Number(row.occurred_at), provenance: null,
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
