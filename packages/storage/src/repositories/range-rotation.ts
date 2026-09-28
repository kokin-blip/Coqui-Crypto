import { canonicalJson, universeHash, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export type RangeRotationRecordKind = 'study' | 'shadow' | 'failure';
export interface RangeRotationRecord { readonly kind: RangeRotationRecordKind; readonly key: string;
  readonly atMs: number; readonly body: unknown; readonly hash: string }
export function appendRangeRotationRecord(profileId: string,
  record: Omit<RangeRotationRecord, 'hash'>, db: Db): boolean {
  const bodyJson = canonicalJson(record.body as CanonicalJsonValue);
  const hash = universeHash({ kind: record.kind, key: record.key, atMs: record.atMs, body: record.body });
  const prior = db.prepare('SELECT content_hash FROM range_rotation_records_v1 WHERE profile_id=? AND kind=? AND record_key=?')
    .get(profileId, record.kind, record.key) as { content_hash: string } | undefined;
  if (prior) { if (prior.content_hash !== hash) throw new Error('range_rotation_record_conflict'); return false; }
  db.prepare('INSERT INTO range_rotation_records_v1 VALUES (?,?,?,?,?,?)')
    .run(profileId, record.kind, record.key, record.atMs, hash, bodyJson);
  return true;
}
export function listRangeRotationRecords(profileId: string, kind: RangeRotationRecordKind, db: Db,
  beforeExclusiveMs = Number.MAX_SAFE_INTEGER): RangeRotationRecord[] {
  const rows = db.prepare(`SELECT * FROM range_rotation_records_v1 WHERE profile_id=? AND kind=?
    AND at_ms<? ORDER BY at_ms,record_key`).all(profileId, kind, beforeExclusiveMs) as Record<string, unknown>[];
  return rows.map((row) => {
    const record = { kind, key: String(row['record_key']), atMs: Number(row['at_ms']),
      body: JSON.parse(String(row['body_json'])) as unknown };
    const hash = universeHash(record);
    if (hash !== row['content_hash']) throw new Error('range_rotation_record_integrity');
    return { ...record, hash };
  });
}
