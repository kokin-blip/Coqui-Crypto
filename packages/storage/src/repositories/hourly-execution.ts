import { canonicalJson, universeHash, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export type HourlyExecutionRecordKind = 'study' | 'observation' | 'shadow' | 'failure';
export interface HourlyExecutionRecord { readonly kind: HourlyExecutionRecordKind; readonly key: string;
  readonly atMs: number; readonly body: unknown; readonly hash: string }

export function appendHourlyExecutionRecord(profileId: string,
  record: Omit<HourlyExecutionRecord, 'hash'>, db: Db): boolean {
  const bodyJson = canonicalJson(record.body as CanonicalJsonValue);
  const hash = universeHash({ kind: record.kind, key: record.key, atMs: record.atMs, body: record.body });
  const prior = db.prepare('SELECT content_hash FROM hourly_execution_records_v1 WHERE profile_id=? AND kind=? AND record_key=?')
    .get(profileId, record.kind, record.key) as { content_hash: string } | undefined;
  if (prior) { if (prior.content_hash !== hash) throw new Error('hourly_execution_record_conflict'); return false; }
  db.prepare('INSERT INTO hourly_execution_records_v1 VALUES (?,?,?,?,?,?)')
    .run(profileId, record.kind, record.key, record.atMs, hash, bodyJson);
  return true;
}

export function listHourlyExecutionRecords(profileId: string, kind: HourlyExecutionRecordKind, db: Db,
  beforeExclusiveMs = Number.MAX_SAFE_INTEGER): HourlyExecutionRecord[] {
  const rows = db.prepare(`SELECT * FROM hourly_execution_records_v1 WHERE profile_id=? AND kind=?
    AND at_ms<? ORDER BY at_ms,record_key`).all(profileId, kind, beforeExclusiveMs) as Record<string, unknown>[];
  return rows.map((row) => {
    const record = { kind, key: String(row['record_key']), atMs: Number(row['at_ms']),
      body: JSON.parse(String(row['body_json'])) as unknown };
    const hash = universeHash(record);
    if (hash !== row['content_hash']) throw new Error('hourly_execution_record_integrity');
    return { ...record, hash };
  });
}

export function getHourlyExecutionRecord(profileId: string, kind: HourlyExecutionRecordKind,
  key: string, db: Db): HourlyExecutionRecord | null {
  const row = db.prepare(`SELECT * FROM hourly_execution_records_v1
    WHERE profile_id=? AND kind=? AND record_key=?`).get(profileId, kind, key) as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  const record = { kind, key, atMs: Number(row['at_ms']), body: JSON.parse(String(row['body_json'])) as unknown };
  const hash = universeHash(record);
  if (hash !== row['content_hash']) throw new Error('hourly_execution_record_integrity');
  return { ...record, hash };
}

export function hourlyExecutionCoverage(profileId: string, db: Db) {
  const observations = db.prepare(`SELECT COUNT(*) AS count FROM hourly_execution_records_v1
    WHERE profile_id=? AND kind='observation'`).get(profileId) as { count: number };
  const complete = db.prepare(`SELECT COUNT(*) AS count FROM (
    SELECT at_ms / 86400000 AS day FROM hourly_execution_records_v1
    WHERE profile_id=? AND kind='observation' GROUP BY day HAVING COUNT(*)=24
  )`).get(profileId) as { count: number };
  return { observations: observations.count, completeDays: complete.count };
}

export function latestHourlyExecutionRecord(profileId: string, kind: HourlyExecutionRecordKind,
  db: Db): HourlyExecutionRecord | null {
  const row = db.prepare(`SELECT record_key FROM hourly_execution_records_v1 WHERE profile_id=? AND kind=?
    ORDER BY at_ms DESC,record_key DESC LIMIT 1`).get(profileId, kind) as { record_key: string } | undefined;
  return row === undefined ? null : getHourlyExecutionRecord(profileId, kind, row.record_key, db);
}
