import { canonicalJson, instrumentKey, mapUniverseProducts, UNIVERSE_DAY, universeHash,
  type CanonicalJsonValue, type DynamicUniverseSlot, type UniverseProductObservation, type UniverseAlpacaAsset } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export type UniverseRecordKind = 'policy' | 'study' | 'catalog' | 'observation' | 'frame' | 'shadow' | 'failure';
export interface UniverseRecord {
  readonly kind: UniverseRecordKind; readonly key: string; readonly atMs: number;
  readonly hash: string; readonly body: unknown;
}
export function appendUniverseRecord(profileId: string, record: Omit<UniverseRecord, 'hash'>, db: Db): boolean {
  const body = canonicalJson(record.body as CanonicalJsonValue);
  const hash = universeHash({ kind: record.kind, key: record.key, atMs: record.atMs, body: record.body });
  const existing = db.prepare('SELECT content_hash FROM wider_universe_records_v1 WHERE profile_id=? AND kind=? AND record_key=?')
    .get(profileId, record.kind, record.key) as { content_hash: string } | undefined;
  if (existing !== undefined) {
    if (existing.content_hash !== hash) throw new Error('universe_record_conflict');
    return false;
  }
  db.prepare('INSERT INTO wider_universe_records_v1 VALUES (?,?,?,?,?,?)')
    .run(profileId, record.kind, record.key, record.atMs, hash, body);
  return true;
}
export function listUniverseRecords(profileId: string, kind: UniverseRecordKind, db: Db,
  beforeExclusiveMs = Number.MAX_SAFE_INTEGER, afterInclusiveMs = 0): UniverseRecord[] {
  const rows = db.prepare(`SELECT * FROM wider_universe_records_v1 WHERE profile_id=? AND kind=? AND at_ms<? AND at_ms>=?
    ORDER BY at_ms, record_key`).all(profileId, kind, beforeExclusiveMs, afterInclusiveMs) as Record<string, unknown>[];
  return rows.map((r) => {
    const record = { kind, key: String(r['record_key']), atMs: Number(r['at_ms']), body: JSON.parse(String(r['body_json'])) as unknown };
    const hash = universeHash(record);
    if (hash !== r['content_hash']) throw new Error('universe_record_integrity');
    return { ...record, hash };
  });
}
export function hasUniverseRecord(profileId: string, kind: UniverseRecordKind, key: string, db: Db): boolean {
  return db.prepare('SELECT 1 FROM wider_universe_records_v1 WHERE profile_id=? AND kind=? AND record_key=?').get(profileId, kind, key) !== undefined;
}

/** Bind each frame back to its full, immutable, prior-day catalog before evaluating returns. */
export function loadUniverseResearchFrames(profileId: string, db: Db, beforeExclusiveMs: number): DynamicUniverseSlot[] {
  const catalogs = new Map(listUniverseRecords(profileId, 'catalog', db, beforeExclusiveMs).map((r) => [r.hash, r]));
  return listUniverseRecords(profileId, 'frame', db, beforeExclusiveMs).map((record) => {
    const frame = record.body as DynamicUniverseSlot;
    const catalog = catalogs.get(frame.catalogHash);
    if (!catalog) throw new Error('universe_catalog_reference_missing');
    const body = catalog.body as { observedAtMs: number; products: UniverseProductObservation[]; assets: UniverseAlpacaAsset[] };
    if (body.observedAtMs !== catalog.atMs || Math.floor(frame.slotMs / UNIVERSE_DAY) !== Math.floor(catalog.atMs / UNIVERSE_DAY) + 1) {
      throw new Error('universe_catalog_not_prior_day');
    }
    const mapped = mapUniverseProducts(body.products, body.assets);
    if (universeHash([...frame.catalogAssetIds].sort()) !== universeHash(mapped.map((m) => instrumentKey(m.product.instrument)).sort()) ||
        frame.observations.length !== mapped.length) throw new Error('universe_catalog_membership_mismatch');
    for (const observation of frame.observations) {
      const e = observation.evidence;
      const expected = mapped.find((m) => instrumentKey(m.product.instrument) === instrumentKey(e.product.instrument));
      if (!expected || observation.atMs !== record.atMs || e.catalogObservedAtMs !== catalog.atMs ||
          universeHash([e.product, e.asset, e.mapping, e.mappingReason]) !==
          universeHash([expected.product, expected.asset, expected.mapping, expected.reason])) throw new Error('universe_frame_provenance_mismatch');
    }
    return frame;
  });
}
