import { sha256Hex } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export interface StoredAdvisorEvidencePack {
  readonly id: string; readonly profileId: string; readonly decisionId: string;
  readonly schemaVersion: 1; readonly decisionHash: string; readonly latestEventSequence: number;
  readonly evidenceJson: string; readonly evidenceHash: string; readonly dataAsOf: number;
  readonly freshness: 'fresh' | 'stale' | 'unavailable'; readonly createdAt: number;
}
export function saveAdvisorEvidencePack(pack: StoredAdvisorEvidencePack, database: Db): void {
  if (sha256Hex(pack.evidenceJson) !== pack.evidenceHash) throw new Error('Advisor evidence hash mismatch.');
  try { JSON.parse(pack.evidenceJson); } catch { throw new TypeError('Advisor evidence must be valid JSON.'); }
  const existing = getAdvisorEvidencePack(pack.id, database);
  if (existing !== null) {
    if (JSON.stringify(existing) !== JSON.stringify(pack)) throw new Error('Advisor evidence identity cannot change.');
    return;
  }
  database.prepare(`INSERT INTO advisor_decision_evidence_packs_v1
    (id,profile_id,decision_id,schema_version,decision_hash,latest_event_sequence,evidence_json,
      evidence_hash,data_as_of,freshness,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      pack.id, pack.profileId, pack.decisionId, pack.schemaVersion, pack.decisionHash,
      pack.latestEventSequence, pack.evidenceJson, pack.evidenceHash, pack.dataAsOf,
      pack.freshness, pack.createdAt);
}
export function getAdvisorEvidencePack(id: string, database: Db): StoredAdvisorEvidencePack | null {
  const row = database.prepare('SELECT * FROM advisor_decision_evidence_packs_v1 WHERE id=?').get(id) as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  const pack: StoredAdvisorEvidencePack = { id: String(row['id']), profileId: String(row['profile_id']),
    decisionId: String(row['decision_id']), schemaVersion: 1, decisionHash: String(row['decision_hash']),
    latestEventSequence: Number(row['latest_event_sequence']), evidenceJson: String(row['evidence_json']),
    evidenceHash: String(row['evidence_hash']), dataAsOf: Number(row['data_as_of']),
    freshness: row['freshness'] as StoredAdvisorEvidencePack['freshness'], createdAt: Number(row['created_at']) };
  if (sha256Hex(pack.evidenceJson) !== pack.evidenceHash) throw new Error('Stored Advisor evidence failed integrity validation.');
  return pack;
}
export type AdvisorNavigationTarget = 'activity' | 'paper' | 'research' | 'risk' | 'market' | 'advisor';
export function appendAdvisorNavigationAudit(input: { readonly profileId: string;
  readonly decisionId: string | null; readonly target: AdvisorNavigationTarget;
  readonly outcome: 'accepted' | 'rejected'; readonly reasonCode: string; readonly at: number;
  readonly selection?:{readonly candidateId:string|null;readonly productId:string|null;readonly eventId:string|null} }, database: Db): string {
  const detailJson = JSON.stringify({ advisoryOnly: true, executionAuthority: false,
    selection:input.selection??{candidateId:null,productId:null,eventId:null} });
  const id = sha256Hex(['advisor-navigation-v1', input.profileId, input.decisionId ?? '', input.target,
    input.outcome, input.reasonCode,detailJson,String(input.at)].join(':'));
  database.prepare(`INSERT OR IGNORE INTO advisor_navigation_audit_events_v1
    (id,profile_id,decision_id,target,outcome,reason_code,at,detail_json) VALUES (?,?,?,?,?,?,?,?)`).run(
      id, input.profileId, input.decisionId, input.target, input.outcome, input.reasonCode, input.at, detailJson);
  return id;
}
