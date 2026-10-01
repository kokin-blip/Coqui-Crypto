import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export interface RemediationEvidence {
  readonly profileId: string; readonly namespace: string; readonly kind: string;
  readonly key: string; readonly atMs: number; readonly body: CanonicalJsonValue;
}

export function appendRemediationEvidence(record: RemediationEvidence, db: Db): boolean {
  if (!record.profileId || !record.namespace || !record.kind || !record.key ||
      !Number.isSafeInteger(record.atMs) || record.atMs < 0) throw new Error('invalid_remediation_evidence');
  const json = canonicalJson(record.body), hash = sha256Hex(canonicalJson(record as unknown as CanonicalJsonValue));
  const prior = db.prepare(`SELECT content_hash FROM remediation_evidence_v1
    WHERE profile_id=? AND namespace=? AND kind=? AND record_key=?`)
    .get(record.profileId, record.namespace, record.kind, record.key) as { content_hash: string } | undefined;
  if (prior) { if (prior.content_hash !== hash) throw new Error('remediation_evidence_conflict'); return false; }
  db.prepare('INSERT INTO remediation_evidence_v1 VALUES (?,?,?,?,?,?,?)')
    .run(record.profileId, record.namespace, record.kind, record.key, record.atMs, hash, json);
  return true;
}

export function listRemediationEvidence(profileId: string, namespace: string, kind: string,
  db: Db, beforeExclusiveMs = Number.MAX_SAFE_INTEGER): RemediationEvidence[] {
  const rows = db.prepare(`SELECT * FROM remediation_evidence_v1 WHERE profile_id=? AND namespace=?
    AND kind=? AND at_ms<? ORDER BY at_ms,record_key`).all(profileId, namespace, kind, beforeExclusiveMs) as Record<string, unknown>[];
  return rows.map((row) => {
    const record: RemediationEvidence = { profileId, namespace, kind, key: String(row['record_key']),
      atMs: Number(row['at_ms']), body: JSON.parse(String(row['body_json'])) as CanonicalJsonValue };
    if (sha256Hex(canonicalJson(record as unknown as CanonicalJsonValue)) !== row['content_hash'])
      throw new Error('remediation_evidence_integrity');
    return record;
  });
}
