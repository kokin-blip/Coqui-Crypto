import { canonicalJson, marketEventClassificationJson, marketEventHash, marketEventId, sha256Hex,
  type CanonicalJsonValue, type MarketEventClassificationV1, type MarketEventV1 } from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const LABELS = new Set(['macro','regulatory','exchange','security','protocol','market_structure','other']);
const SENTIMENTS = new Set(['positive','neutral','negative','unknown']);

function assertEvent(event: MarketEventV1): void {
  if (event.schemaVersion !== 1 || !SAFE_ID.test(event.profileId) || !SAFE_ID.test(event.sourceId) ||
      event.sourceEventId.length < 1 || event.sourceEventId.length > 200 || event.title.trim().length < 1 ||
      event.title.length > 240 || event.summary.length > 2_000 || event.assetSymbols.length > 32 ||
      !event.assetSymbols.every((symbol) => SYMBOL.test(symbol)) || new Set(event.assetSymbols).size !== event.assetSymbols.length ||
      !Number.isSafeInteger(event.publishedAtMs) || !Number.isSafeInteger(event.firstSeenAtMs) ||
      event.publishedAtMs < 0 || event.firstSeenAtMs < event.publishedAtMs ||
      event.provenance.kind !== 'local_fixture' || event.provenance.reference.length < 1 ||
      event.provenance.reference.length > 300 ||
      event.id !== marketEventId(event.profileId, event.sourceId, event.sourceEventId)) {
    throw new TypeError('Invalid local market event.');
  }
}

function assertClassification(value: MarketEventClassificationV1): void {
  if (value.schemaVersion !== 1 || !HASH.test(value.eventId) || !SAFE_ID.test(value.classifierVersion) ||
      !LABELS.has(value.label) || !SENTIMENTS.has(value.sentiment) ||
      !['low','medium','high'].includes(value.importance) || !Number.isSafeInteger(value.classifiedAtMs) ||
      value.classifiedAtMs < 0) throw new TypeError('Invalid market-event classification.');
}

export interface StoredMarketEvent {
  readonly event: MarketEventV1;
  readonly contentHash: string;
  readonly provenanceHash: string;
}

export function saveMarketEvent(event: MarketEventV1, database: Db): { readonly inserted: boolean; readonly stored: StoredMarketEvent } {
  assertEvent(event);
  const contentJson = canonicalJson({ schemaVersion: event.schemaVersion, id: event.id,
    profileId: event.profileId, sourceId: event.sourceId, sourceEventId: event.sourceEventId,
    title: event.title, summary: event.summary, assetSymbols: event.assetSymbols,
    publishedAtMs: event.publishedAtMs, firstSeenAtMs: event.firstSeenAtMs,
    provenance: event.provenance } as unknown as CanonicalJsonValue);
  const contentHash = marketEventHash(event);
  const provenanceJson = canonicalJson(event.provenance as unknown as CanonicalJsonValue);
  const provenanceHash = sha256Hex(provenanceJson);
  return inTransaction(database, () => {
    const prior = database.prepare(`SELECT content_json,content_hash,provenance_hash FROM market_events_v1
      WHERE profile_id=? AND source_id=? AND source_event_id=?`).get(event.profileId, event.sourceId, event.sourceEventId) as
      { content_json: string; content_hash: string; provenance_hash: string } | undefined;
    if (prior !== undefined) {
      if (prior.content_json !== contentJson || prior.content_hash !== contentHash || prior.provenance_hash !== provenanceHash) {
        throw new Error('Market event identity cannot change content.');
      }
      return { inserted: false, stored: { event, contentHash, provenanceHash } };
    }
    database.prepare(`INSERT INTO market_events_v1
      (id,profile_id,source_id,source_event_id,published_at,first_seen_at,content_json,content_hash,provenance_json,provenance_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(event.id, event.profileId, event.sourceId, event.sourceEventId,
        event.publishedAtMs, event.firstSeenAtMs, contentJson, contentHash, provenanceJson, provenanceHash);
    return { inserted: true, stored: { event, contentHash, provenanceHash } };
  });
}

export function saveMarketEventClassification(value: MarketEventClassificationV1, database: Db): string {
  assertClassification(value);
  const resultJson = marketEventClassificationJson(value), resultHash = sha256Hex(resultJson);
  const id = sha256Hex(`market-event-classification-v1:${value.eventId}:${value.classifier}:${value.classifierVersion}`);
  const prior = database.prepare('SELECT result_json,result_hash FROM market_event_classifications_v1 WHERE id=?')
    .get(id) as { result_json: string; result_hash: string } | undefined;
  if (prior !== undefined) {
    if (prior.result_json !== resultJson || prior.result_hash !== resultHash) throw new Error('Classification identity cannot change.');
    return id;
  }
  database.prepare(`INSERT INTO market_event_classifications_v1
    (id,event_id,classifier,classifier_version,classified_at,result_json,result_hash) VALUES (?,?,?,?,?,?,?)`)
    .run(id, value.eventId, value.classifier, value.classifierVersion, value.classifiedAtMs, resultJson, resultHash);
  return id;
}

export interface MarketEventTimelineItem extends StoredMarketEvent {
  readonly classification: MarketEventClassificationV1 | null;
  readonly classificationId: string | null;
  readonly classificationHash: string | null;
}

interface MarketEventRow {
  readonly content_json:string;readonly content_hash:string;readonly provenance_hash:string;
  readonly classification_id:string|null;readonly result_json:string|null;readonly result_hash:string|null;
}

function restoreMarketEvent(row:MarketEventRow):MarketEventTimelineItem {
  const event=JSON.parse(row.content_json) as MarketEventV1;
  assertEvent(event);
  if(marketEventHash(event)!==row.content_hash||
      sha256Hex(canonicalJson(event.provenance as unknown as CanonicalJsonValue))!==row.provenance_hash) {
    throw new Error('Stored market event failed integrity validation.');
  }
  const classification=row.result_json===null?null:JSON.parse(row.result_json) as MarketEventClassificationV1;
  if(classification!==null) {
    assertClassification(classification);
    if(sha256Hex(marketEventClassificationJson(classification))!==row.result_hash) {
      throw new Error('Stored classification failed integrity validation.');
    }
  }
  return {event,contentHash:row.content_hash,provenanceHash:row.provenance_hash,classification,
    classificationId:row.classification_id,classificationHash:row.result_hash};
}

export function getMarketEvent(profileId:string,eventId:string,database:Db):MarketEventTimelineItem|null {
  if(!SAFE_ID.test(profileId)||!HASH.test(eventId)) throw new TypeError('Invalid market-event read.');
  const row=database.prepare(`SELECT event.content_json,event.content_hash,event.provenance_hash,
      classification.id AS classification_id,classification.result_json,classification.result_hash
    FROM market_events_v1 event LEFT JOIN market_event_classifications_v1 classification
      ON classification.id=(SELECT candidate.id FROM market_event_classifications_v1 candidate
        WHERE candidate.event_id=event.id ORDER BY candidate.classified_at DESC,candidate.id DESC LIMIT 1)
    WHERE event.profile_id=? AND event.id=?`).get(profileId,eventId) as MarketEventRow|undefined;
  return row===undefined?null:restoreMarketEvent(row);
}

/** Temporal read: neither an event nor a later classification can travel back in time. */
export function listMarketEventsAsOf(profileId: string, asOfMs: number, limit: number,
  database: Db): readonly MarketEventTimelineItem[] {
  if (!SAFE_ID.test(profileId) || !Number.isSafeInteger(asOfMs) || asOfMs < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Invalid market-event read.');
  const rows = database.prepare(`SELECT event.content_json,event.content_hash,event.provenance_hash,
      classification.id AS classification_id,classification.result_json,classification.result_hash
    FROM market_events_v1 event LEFT JOIN market_event_classifications_v1 classification
      ON classification.id=(SELECT candidate.id FROM market_event_classifications_v1 candidate
        WHERE candidate.event_id=event.id AND candidate.classified_at<=?
        ORDER BY candidate.classified_at DESC,candidate.id DESC LIMIT 1)
    WHERE event.profile_id=? AND event.first_seen_at<=?
    ORDER BY event.published_at DESC,event.id DESC LIMIT ?`).all(asOfMs,profileId,asOfMs,limit) as unknown as MarketEventRow[];
  return Object.freeze(rows.map(restoreMarketEvent));
}
