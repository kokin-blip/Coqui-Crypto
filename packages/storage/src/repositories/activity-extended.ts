import type { ActivityFeedEvent } from './activity.js';
import type { Db } from '../sqlite/index.js';

export function listExtendedActivityEvents(
  profileId: string, limit: number, database: Db,
): readonly ActivityFeedEvent[] {
  const scheduler = database.prepare(`SELECT id,owner_id,kind,at FROM scheduler_lease_events_v1
    WHERE profile_id=? ORDER BY at DESC,id DESC LIMIT ?`).all(profileId, limit) as Record<string, unknown>[];
  const execution = database.prepare(`SELECT id,owner_id,kind,at FROM execution_lease_events_v1
    WHERE profile_id=? ORDER BY at DESC,id DESC LIMIT ?`).all(profileId, limit) as Record<string, unknown>[];
  const hosts = database.prepare(`SELECT id,action,next_host_id,at FROM host_takeover_history_v1
    WHERE profile_id=? ORDER BY at DESC,id DESC LIMIT ?`).all(profileId, limit) as Record<string, unknown>[];
  const markets = database.prepare(`SELECT id,source_id,first_seen_at,content_hash FROM market_events_v1
    WHERE profile_id=? ORDER BY first_seen_at DESC,id DESC LIMIT ?`).all(profileId, limit) as Record<string, unknown>[];
  const navigation = database.prepare(`SELECT id,target,outcome,reason_code,at,decision_id
    FROM advisor_navigation_audit_events_v1 WHERE profile_id=?
    ORDER BY at DESC,id DESC LIMIT ?`).all(profileId, limit) as Record<string, unknown>[];
  return Object.freeze([
    ...scheduler.map((row): ActivityFeedEvent => ({
      id: `scheduler:${String(row['id'])}`, kind: 'host',
      status: row['kind'] === 'lost' || row['kind'] === 'cancelled' ? 'blocked' : 'info',
      title: `Scheduler lease ${String(row['kind'])}`,
      detail: `Owner ${String(row['owner_id'])} recorded a scheduler coordination event.`,
      occurredAt: Number(row['at']), provenance: String(row['id']), decisionId: null,
      evidenceId: String(row['id']), reasonCode: null, assetScopes: Object.freeze(['GLOBAL']),
    })),
    ...execution.map((row): ActivityFeedEvent => ({
      id: `execution-lease:${String(row['id'])}`, kind: 'host',
      status: row['kind'] === 'lost' ? 'blocked' : 'info',
      title: `Execution authority ${String(row['kind'])}`,
      detail: `Owner ${String(row['owner_id'])} recorded a fenced execution lease event.`,
      occurredAt: Number(row['at']), provenance: String(row['id']), decisionId: null,
      evidenceId: String(row['id']), reasonCode: null, assetScopes: Object.freeze(['GLOBAL']),
    })),
    ...hosts.map((row): ActivityFeedEvent => ({
      id: `host:${String(row['id'])}`, kind: 'host', status: 'info',
      title: `Host authority ${String(row['action'])}`,
      detail: row['next_host_id'] === null ? 'No local host currently owns this profile.' :
        `Authoritative host ${String(row['next_host_id'])}.`,
      occurredAt: Number(row['at']), provenance: String(row['id']), decisionId: null,
      evidenceId: String(row['id']), reasonCode: null, assetScopes: Object.freeze(['GLOBAL']),
    })),
    ...markets.map((row): ActivityFeedEvent => ({
      id: `market:${String(row['id'])}`, kind: 'market', status: 'info',
      title: 'Market event first observed', detail: `Source ${String(row['source_id'])}.`,
      occurredAt: Number(row['first_seen_at']), provenance: String(row['content_hash']),
      decisionId: null, evidenceId: String(row['id']), reasonCode: null,
      assetScopes: Object.freeze(['GLOBAL']),
    })),
    ...navigation.map((row): ActivityFeedEvent => ({
      id: `advisor-navigation:${String(row['id'])}`, kind: 'reconciliation',
      status: row['outcome'] === 'accepted' ? 'succeeded' : 'blocked',
      title: `Advisor navigation ${String(row['outcome'])}`,
      detail: `Destination ${String(row['target'])}.`, occurredAt: Number(row['at']),
      provenance: String(row['id']), decisionId: row['decision_id'] === null ? null : String(row['decision_id']),
      evidenceId: String(row['id']), reasonCode: String(row['reason_code']),
      assetScopes: Object.freeze(['GLOBAL']),
    })),
  ]);
}
