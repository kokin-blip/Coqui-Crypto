import { canonicalJson, universeHash, type BreakoutHourlyBar, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export interface StoredBreakoutHourlyBar extends BreakoutHourlyBar {
  readonly source: 'authenticated' | 'public'; readonly retrievedAtMs: number;
}
export function saveBreakoutHourlyBars(profileId: string, bars: readonly StoredBreakoutHourlyBar[], db: Db): void {
  const get = db.prepare(`SELECT content_hash FROM breakout_hourly_bars_v1
    WHERE profile_id=? AND asset_id=? AND start_ms=?`);
  const put = db.prepare(`INSERT INTO breakout_hourly_bars_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN');
  try {
    for (const bar of bars) {
      const hash = universeHash([bar.assetId, bar.startTimeMs, bar.open, bar.high, bar.low, bar.close, bar.volume]);
      const previous = get.get(profileId, bar.assetId, bar.startTimeMs) as { content_hash: string } | undefined;
      if (previous) { if (previous.content_hash !== hash) throw new Error('breakout_hourly_conflict'); continue; }
      put.run(profileId, bar.assetId, bar.startTimeMs, bar.open, bar.high, bar.low, bar.close,
        bar.volume, bar.source, bar.retrievedAtMs, hash);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function listBreakoutHourlyBars(profileId: string, assetId: string, fromMs: number, toMs: number,
  beforeRetrievedMs: number, db: Db): readonly StoredBreakoutHourlyBar[] {
  const rows = db.prepare(`SELECT * FROM breakout_hourly_bars_v1 WHERE profile_id=? AND asset_id=?
    AND start_ms>=? AND start_ms<? AND retrieved_at_ms<=? ORDER BY start_ms`)
    .all(profileId, assetId, fromMs, toMs, beforeRetrievedMs) as Record<string, unknown>[];
  return rows.map((row) => {
    const bar = { assetId: String(row['asset_id']), startTimeMs: Number(row['start_ms']),
      open: String(row['open']), high: String(row['high']), low: String(row['low']), close: String(row['close']),
      volume: row['volume'] === null ? null : String(row['volume']),
      source: String(row['source']) as StoredBreakoutHourlyBar['source'], retrievedAtMs: Number(row['retrieved_at_ms']) };
    if (universeHash([bar.assetId, bar.startTimeMs, bar.open, bar.high, bar.low, bar.close, bar.volume]) !== row['content_hash']) {
      throw new Error('breakout_hourly_integrity');
    }
    return bar;
  });
}

export type BreakoutRecordKind = 'study' | 'shadow' | 'failure';
export interface BreakoutRecord { readonly kind: BreakoutRecordKind; readonly key: string; readonly atMs: number;
  readonly body: unknown; readonly hash: string }
export function appendBreakoutRecord(profileId: string, record: Omit<BreakoutRecord, 'hash'>, db: Db): boolean {
  const bodyJson = canonicalJson(record.body as CanonicalJsonValue);
  const hash = universeHash({ kind: record.kind, key: record.key, atMs: record.atMs, body: record.body });
  const prior = db.prepare('SELECT content_hash FROM breakout_research_records_v1 WHERE profile_id=? AND kind=? AND record_key=?')
    .get(profileId, record.kind, record.key) as { content_hash: string } | undefined;
  if (prior) { if (prior.content_hash !== hash) throw new Error('breakout_record_conflict'); return false; }
  db.prepare('INSERT INTO breakout_research_records_v1 VALUES (?,?,?,?,?,?)')
    .run(profileId, record.kind, record.key, record.atMs, hash, bodyJson);
  return true;
}
export function listBreakoutRecords(profileId: string, kind: BreakoutRecordKind, db: Db,
  beforeExclusiveMs = Number.MAX_SAFE_INTEGER): BreakoutRecord[] {
  const rows = db.prepare(`SELECT * FROM breakout_research_records_v1 WHERE profile_id=? AND kind=?
    AND at_ms<? ORDER BY at_ms,record_key`).all(profileId, kind, beforeExclusiveMs) as Record<string, unknown>[];
  return rows.map((row) => {
    const record = { kind, key: String(row['record_key']), atMs: Number(row['at_ms']),
      body: JSON.parse(String(row['body_json'])) as unknown };
    const hash = universeHash(record);
    if (hash !== row['content_hash']) throw new Error('breakout_record_integrity');
    return { ...record, hash };
  });
}
