import { canonicalJson, universeHash, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export type MarketSelectorRecordKind = 'study' | 'shadow' | 'failure';
export interface MarketSelectorRecord { readonly kind: MarketSelectorRecordKind; readonly key: string;
  readonly atMs: number; readonly body: unknown; readonly hash: string }
export function appendMarketSelectorRecord(profileId: string,
  record: Omit<MarketSelectorRecord, 'hash'>, db: Db): boolean {
  const bodyJson = canonicalJson(record.body as CanonicalJsonValue);
  const hash = universeHash({ kind: record.kind, key: record.key, atMs: record.atMs, body: record.body });
  const prior = db.prepare('SELECT content_hash FROM market_selector_records_v1 WHERE profile_id=? AND kind=? AND record_key=?')
    .get(profileId, record.kind, record.key) as { content_hash: string } | undefined;
  if (prior) { if (prior.content_hash !== hash) throw new Error('market_selector_record_conflict'); return false; }
  db.prepare('INSERT INTO market_selector_records_v1 VALUES (?,?,?,?,?,?)')
    .run(profileId, record.kind, record.key, record.atMs, hash, bodyJson);
  return true;
}
export function listMarketSelectorRecords(profileId: string, kind: MarketSelectorRecordKind, db: Db,
  beforeExclusiveMs = Number.MAX_SAFE_INTEGER): MarketSelectorRecord[] {
  const rows = db.prepare(`SELECT * FROM market_selector_records_v1 WHERE profile_id=? AND kind=?
    AND at_ms<? ORDER BY at_ms,record_key`).all(profileId, kind, beforeExclusiveMs) as Record<string, unknown>[];
  return rows.map((row) => {
    const record = { kind, key: String(row['record_key']), atMs: Number(row['at_ms']),
      body: JSON.parse(String(row['body_json'])) as unknown };
    const hash = universeHash(record);
    if (hash !== row['content_hash']) throw new Error('market_selector_record_integrity');
    return { ...record, hash };
  });
}
