import {
  assertNewsObservation, canonicalJson, canonicalNewsUrl, isNewsTimestamp,
  NEWS_NORMALIZATION_VERSION, newsContentHash, newsObservationId,
  newsProviderRecordId, newsProviderRecordKey, sha256Hex,
  type CanonicalJsonValue, type NewsObservation, type StoredNewsObservation,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

interface NewsRow {
  readonly id: string;
  readonly article_id: string;
  readonly provider_record_id: string;
  readonly provider: string;
  readonly record_key: string;
  readonly provider_article_id: string | null;
  readonly canonical_url: string;
  readonly url_hash: string;
  readonly normalization_version: number;
  readonly content_hash: string;
  readonly observed_at: number;
  readonly persisted_at: number;
  readonly observation_json: string;
}

const SELECT_NEWS = `SELECT observation.*,record.article_id,record.provider,record.record_key,
  record.provider_article_id,article.canonical_url,article.url_hash
  FROM news_observations_v1 observation
  JOIN news_provider_records_v1 record ON record.id=observation.provider_record_id
  JOIN news_articles_v1 article ON article.id=record.article_id`;

function restore(row: NewsRow): StoredNewsObservation {
  const observation: unknown = JSON.parse(row.observation_json);
  assertNewsObservation(observation);
  const urlHash = sha256Hex(canonicalNewsUrl(observation.url));
  const recordKey = newsProviderRecordKey(observation.providerArticleId, urlHash);
  if (row.normalization_version !== NEWS_NORMALIZATION_VERSION ||
      canonicalNewsUrl(observation.url) !== row.canonical_url || urlHash !== row.url_hash || row.article_id !== urlHash ||
      observation.provider !== row.provider || observation.providerArticleId !== row.provider_article_id ||
      recordKey !== row.record_key || newsProviderRecordId(observation.provider, recordKey) !== row.provider_record_id ||
      newsContentHash(observation) !== row.content_hash ||
      newsObservationId(row.provider_record_id, row.content_hash) !== row.id ||
      observation.observedAtMs !== row.observed_at || !isNewsTimestamp(row.persisted_at) ||
      row.persisted_at < row.observed_at) throw new Error('Stored news failed integrity validation.');
  return Object.freeze({ observationId: row.id, articleId: row.article_id,
    providerRecordId: row.provider_record_id, canonicalUrl: row.canonical_url, urlHash: row.url_hash,
    normalizationVersion: NEWS_NORMALIZATION_VERSION, contentHash: row.content_hash,
    observation: Object.freeze({ ...observation,
      entities: Object.freeze(observation.entities.map(entity => Object.freeze({ ...entity }))) }),
    persistedAtMs: row.persisted_at, availableAtMs: Math.max(row.observed_at, row.persisted_at) });
}

export interface NewsSaveResult {
  readonly inserted: boolean;
  readonly stored: StoredNewsObservation;
}

/** One atomic append; identical metadata retains its original availability time. */
export function saveNewsObservation(observation: NewsObservation, persistedAtMs: number, database: Db): NewsSaveResult {
  assertNewsObservation(observation);
  if (!isNewsTimestamp(persistedAtMs) || persistedAtMs < observation.observedAtMs) {
    throw new TypeError('Invalid news persistence time.');
  }
  const canonicalUrl = canonicalNewsUrl(observation.url), urlHash = sha256Hex(canonicalUrl);
  const recordKey = newsProviderRecordKey(observation.providerArticleId, urlHash);
  const recordId = newsProviderRecordId(observation.provider, recordKey);
  const contentHash = newsContentHash(observation), id = newsObservationId(recordId, contentHash);
  return inTransaction(database, () => {
    const record = database.prepare('SELECT article_id FROM news_provider_records_v1 WHERE id=?')
      .get(recordId) as { article_id: string } | undefined;
    if (record !== undefined && record.article_id !== urlHash) {
      throw new Error('News provider identity cannot change canonical URL.');
    }
    const prior = database.prepare(`${SELECT_NEWS} WHERE observation.id=?`).get(id) as unknown as NewsRow | undefined;
    if (prior !== undefined) return Object.freeze({ inserted: false, stored: restore(prior) });
    const article = database.prepare('SELECT canonical_url FROM news_articles_v1 WHERE id=?')
      .get(urlHash) as { canonical_url: string } | undefined;
    if (article !== undefined && article.canonical_url !== canonicalUrl) throw new Error('News URL fingerprint conflict.');
    if (article === undefined) {
      database.prepare(`INSERT INTO news_articles_v1
        (id,canonical_url,url_hash,normalization_version,first_observed_at,persisted_at) VALUES (?,?,?,?,?,?)`)
        .run(urlHash, canonicalUrl, urlHash, NEWS_NORMALIZATION_VERSION, observation.observedAtMs, persistedAtMs);
    }
    if (record === undefined) {
      database.prepare(`INSERT INTO news_provider_records_v1
        (id,article_id,provider,record_key,provider_article_id,first_observed_at,persisted_at) VALUES (?,?,?,?,?,?,?)`)
        .run(recordId, urlHash, observation.provider, recordKey, observation.providerArticleId,
          observation.observedAtMs, persistedAtMs);
    }
    database.prepare(`INSERT INTO news_observations_v1
      (id,provider_record_id,content_hash,normalization_version,observed_at,persisted_at,observation_json)
      VALUES (?,?,?,?,?,?,?)`).run(id, recordId, contentHash, NEWS_NORMALIZATION_VERSION,
        observation.observedAtMs, persistedAtMs, canonicalJson(observation as unknown as CanonicalJsonValue));
    const row = database.prepare(`${SELECT_NEWS} WHERE observation.id=?`).get(id) as unknown as NewsRow;
    return Object.freeze({ inserted: true, stored: restore(row) });
  });
}

/** Latest eligible revision per provider record, preserving cross-provider provenance. */
export function listNewsObservationsAsOf(asOfMs: number, limit: number, database: Db): readonly StoredNewsObservation[] {
  if (!isNewsTimestamp(asOfMs) || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
    throw new TypeError('Invalid news historical read.');
  }
  const rows = database.prepare(`${SELECT_NEWS}
    WHERE observation.id=(SELECT candidate.id FROM news_observations_v1 candidate
      WHERE candidate.provider_record_id=record.id AND candidate.observed_at<=? AND candidate.persisted_at<=?
      ORDER BY candidate.observed_at DESC,candidate.persisted_at DESC,candidate.id DESC LIMIT 1)
    ORDER BY observation.observed_at DESC,observation.persisted_at DESC,observation.id DESC LIMIT ?`)
    .all(asOfMs, asOfMs, limit) as unknown as NewsRow[];
  return Object.freeze(rows.map(restore));
}
