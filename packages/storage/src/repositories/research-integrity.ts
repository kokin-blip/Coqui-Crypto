import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';
export interface IntegrityEvent {
  readonly namespace: string; readonly kind: string; readonly key: string; readonly atMs: number;
  readonly body: CanonicalJsonValue; readonly hash: string;
}
interface Row { namespace: string; kind: string; record_key: string; at_ms: number; body_json: string; content_hash: string }
export function appendIntegrityEvent(event: Omit<IntegrityEvent, 'hash'>, db: Db): string {
  if (!event.namespace || !event.kind || !event.key || !Number.isSafeInteger(event.atMs) || event.atMs < 0) throw new TypeError('Invalid integrity event');
  const bodyJson = canonicalJson(event.body);
  const hash = sha256Hex(canonicalJson({ namespace: event.namespace, kind: event.kind, key: event.key, atMs: event.atMs, body: event.body }));
  db.prepare(`INSERT INTO research_integrity_events(namespace,kind,record_key,at_ms,body_json,content_hash)
    VALUES(?,?,?,?,?,?)`).run(event.namespace, event.kind, event.key, event.atMs, bodyJson, hash);
  return hash;
}
export function listIntegrityEvents(namespace: string | null, kind: string, db: Db): readonly IntegrityEvent[] {
  const rows = (namespace === null
    ? db.prepare('SELECT * FROM research_integrity_events WHERE kind=? ORDER BY sequence').all(kind)
    : db.prepare('SELECT * FROM research_integrity_events WHERE namespace=? AND kind=? ORDER BY sequence').all(namespace, kind)) as unknown as Row[];
  return rows.map((row) => {
    const event = { namespace: row.namespace, kind: row.kind, key: row.record_key, atMs: row.at_ms,
      body: JSON.parse(row.body_json) as CanonicalJsonValue };
    if (sha256Hex(canonicalJson(event)) !== row.content_hash) throw new Error('Integrity event hash mismatch');
    return { ...event, hash: row.content_hash };
  });
}
export function claimIntegrityHoldout(input: { readonly planHash: string; readonly startMs: number;
  readonly endExclusiveMs: number; readonly assets: readonly string[]; readonly dataLineage: string;
  readonly freezeHash: string; readonly atMs: number }, db: Db): void {
  if (!Number.isSafeInteger(input.startMs) || !Number.isSafeInteger(input.endExclusiveMs) ||
      input.startMs >= input.endExclusiveMs || input.assets.length === 0) throw new TypeError('Invalid holdout claim');
  db.exec('BEGIN IMMEDIATE');
  try {
    const legacy = db.prepare(`SELECT p.plan_json FROM research_preregistrations p
      JOIN trial_registry_records t ON t.id=('pre-registration:' || p.id)`).all() as { plan_json: string }[];
    for (const row of legacy) {
      const plan = JSON.parse(row.plan_json) as { validation: { holdout: { startMs: number; endExclusiveMs: number } };
        execution: { baseTargets: { assetId: string }[] } };
      if (plan.validation.holdout.startMs < input.endExclusiveMs && input.startMs < plan.validation.holdout.endExclusiveMs &&
          plan.execution.baseTargets.some((target) => input.assets.includes(target.assetId))) throw new Error('Legacy holdout interval already consumed');
    }
    const claims = listIntegrityEvents(null, 'final_claim', db);
    for (const claim of claims) {
      const body = claim.body as unknown as typeof input;
      // Compare instruments and time, not plan name or a researcher-chosen lineage alias.
      if (body.startMs < input.endExclusiveMs && input.startMs < body.endExclusiveMs &&
          body.assets.some((asset) => input.assets.includes(asset))) throw new Error('Holdout interval already consumed');
    }
    appendIntegrityEvent({ namespace: input.planHash, kind: 'final_claim', key: 'once', atMs: input.atMs,
      body: input as unknown as CanonicalJsonValue }, db);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
