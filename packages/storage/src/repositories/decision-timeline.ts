import type { DecisionEvidenceEventV1, ExecutionRouteV1, PaperVenueProvider, StrategyDecisionV1 } from '@coqui/core';

import { getStrategyDecision, listDecisionEvidenceEvents } from './decision-evidence.js';
import type { Db } from '../sqlite/index.js';

export interface DecisionTimelineItemV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly decisionId: string;
  readonly eventId: string;
  readonly kind: string;
  readonly status: 'pending' | 'succeeded' | 'blocked' | 'unknown';
  readonly occurredAtMs: number;
  readonly reasonCode: string | null;
  readonly payloadHash: string;
  readonly assetScopes: readonly string[];
  readonly globalScope: boolean;
}

function eventStatus(kind: string): DecisionTimelineItemV1['status'] {
  if (kind === 'execution_submitted') return 'pending';
  if (kind === 'stand_down' || kind === 'no_trade' || kind === 'execution_refused') return 'blocked';
  if (kind === 'recovery') return 'unknown';
  return 'succeeded';
}

export function listDecisionTimeline(input: {
  readonly profileId: string;
  readonly assetScope: string | null;
  readonly asOfMs: number | null;
  readonly limit: number;
}, database: Db): readonly DecisionTimelineItemV1[] {
  const rows = database.prepare(`SELECT event.id,event.decision_id,event.kind,event.reason_code,
    event.at,event.payload_hash,GROUP_CONCAT(link.asset_scope) AS asset_scopes
    FROM decision_evidence_events_v1 event
    JOIN decision_evidence_asset_links_v1 link ON link.event_id=event.id
    WHERE event.profile_id=? AND (? IS NULL OR event.at<=?)
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM decision_evidence_asset_links_v1 selected
        WHERE selected.event_id=event.id AND selected.asset_scope IN (?, 'GLOBAL')
      ))
    GROUP BY event.id ORDER BY event.at DESC,event.id DESC LIMIT ?`)
    .all(input.profileId, input.asOfMs, input.asOfMs, input.assetScope, input.assetScope,
      input.limit) as Record<string, unknown>[];
  return Object.freeze(rows.map((row) => {
    const scopes = String(row['asset_scopes']).split(',').sort();
    return Object.freeze({
      schemaVersion: 1 as const, id: `decision-timeline-v1:${String(row['id'])}`,
      decisionId: String(row['decision_id']), eventId: String(row['id']),
      kind: String(row['kind']), status: eventStatus(String(row['kind'])),
      occurredAtMs: Number(row['at']), reasonCode: row['reason_code'] === null ? null : String(row['reason_code']),
      payloadHash: String(row['payload_hash']), assetScopes: Object.freeze(scopes),
      globalScope: scopes.includes('GLOBAL'),
    });
  }));
}

export interface DecisionDetailV1 {
  readonly schemaVersion: 1;
  readonly decision: StrategyDecisionV1;
  readonly decisionHash: string;
  readonly assetScopes: readonly string[];
  readonly events: readonly {
    readonly eventId: string;
    readonly payloadHash: string;
    readonly event: DecisionEvidenceEventV1;
  }[];
  readonly routes: readonly {
    readonly routeId: string; readonly connectionId: string; readonly provider: PaperVenueProvider;
    readonly exposureKey: string; readonly productId: string; readonly side: 'buy' | 'sell';
    readonly amountUsd: string; readonly assumptionHash: string; readonly contentHash: string;
  }[];
}

export function getDecisionDetail(
  profileId: string, decisionId: string, database: Db,
): DecisionDetailV1 | null {
  const stored = getStrategyDecision(decisionId, database);
  if (stored === null || stored.decision.profileId !== profileId) return null;
  const scopes = (database.prepare(`SELECT asset_scope FROM decision_asset_links_v1
    WHERE decision_id=? AND profile_id=? ORDER BY asset_scope`).all(decisionId, profileId) as
    { asset_scope: string }[]).map((row) => row.asset_scope);
  const events = listDecisionEvidenceEvents(decisionId, profileId, database).map((event) => {
    const row = database.prepare(`SELECT id,payload_hash FROM decision_evidence_events_v1
      WHERE decision_id=? AND sequence=?`).get(decisionId, event.sequence) as
      { id: string; payload_hash: string };
    return Object.freeze({ eventId: row.id, payloadHash: row.payload_hash, event });
  });
  const routes = (database.prepare(`SELECT id,connection_id,provider,assumption_hash,content_hash,content_json
    FROM execution_routes_v1 WHERE decision_id=? AND profile_id=? ORDER BY id`)
    .all(decisionId, profileId) as Record<string, unknown>[]).map((row) => {
    const content = JSON.parse(String(row['content_json'])) as ExecutionRouteV1;
    return Object.freeze({ routeId: String(row['id']), connectionId: String(row['connection_id']),
      provider: content.provider, exposureKey: content.exposureKey,
      productId: content.instrument.productId, side: content.side, amountUsd: content.amountUsd,
      assumptionHash: String(row['assumption_hash']), contentHash: String(row['content_hash']) });
  });
  return Object.freeze({ schemaVersion: 1, decision: stored.decision,
    decisionHash: stored.contentHash, assetScopes: Object.freeze(scopes),
    events: Object.freeze(events), routes: Object.freeze(routes) });
}
