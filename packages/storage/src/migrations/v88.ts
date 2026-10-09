import type { Migration } from './types.js';

export const migrations88: readonly Migration[] = [{
  version: 88,
  name: 'news_intelligence_foundation_v1',
  up(db) {
    db.exec(`
      CREATE TABLE news_articles_v1 (
        id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64),
        canonical_url TEXT NOT NULL UNIQUE,
        url_hash TEXT NOT NULL UNIQUE CHECK(length(url_hash)=64),
        normalization_version INTEGER NOT NULL CHECK(normalization_version=1),
        first_observed_at INTEGER NOT NULL CHECK(typeof(first_observed_at)='integer' AND first_observed_at BETWEEN 0 AND 9007199254740991),
        persisted_at INTEGER NOT NULL CHECK(typeof(persisted_at)='integer' AND persisted_at BETWEEN first_observed_at AND 9007199254740991)
      );
      CREATE TABLE news_provider_records_v1 (
        id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64),
        article_id TEXT NOT NULL REFERENCES news_articles_v1(id),
        provider TEXT NOT NULL CHECK(provider IN ('marketaux','currents','gdelt')),
        record_key TEXT NOT NULL,
        provider_article_id TEXT,
        first_observed_at INTEGER NOT NULL CHECK(typeof(first_observed_at)='integer' AND first_observed_at BETWEEN 0 AND 9007199254740991),
        persisted_at INTEGER NOT NULL CHECK(typeof(persisted_at)='integer' AND persisted_at BETWEEN first_observed_at AND 9007199254740991),
        UNIQUE(provider,record_key),
        UNIQUE(provider,provider_article_id)
      );
      CREATE TABLE news_observations_v1 (
        id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64),
        provider_record_id TEXT NOT NULL REFERENCES news_provider_records_v1(id),
        content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
        normalization_version INTEGER NOT NULL CHECK(normalization_version=1),
        observed_at INTEGER NOT NULL CHECK(typeof(observed_at)='integer' AND observed_at BETWEEN 0 AND 9007199254740991),
        persisted_at INTEGER NOT NULL CHECK(typeof(persisted_at)='integer' AND persisted_at BETWEEN observed_at AND 9007199254740991),
        observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
        UNIQUE(provider_record_id,content_hash)
      );
      CREATE INDEX news_observations_as_of ON news_observations_v1(persisted_at,observed_at);
      CREATE INDEX news_observations_record_as_of ON news_observations_v1(provider_record_id,persisted_at,observed_at);
      CREATE INDEX news_provider_records_article ON news_provider_records_v1(article_id);
    `);
    for (const table of ['news_articles_v1', 'news_provider_records_v1', 'news_observations_v1']) {
      db.exec(`
        CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
        BEGIN SELECT RAISE(ABORT, 'news evidence is immutable'); END;
        CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
        BEGIN SELECT RAISE(ABORT, 'news evidence is immutable'); END;
      `);
    }
  },
}];
