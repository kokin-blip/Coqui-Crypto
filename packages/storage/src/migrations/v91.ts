import type { Migration } from './types.js';

/** Immutable analysis chunks are the restart checkpoint; no mutable evidence. */
export const migrations91: readonly Migration[] = [{ version: 91, name: 'news_analysis_chunks_v1', up(db) {
  db.exec(`CREATE TABLE news_analysis_chunks_v1 (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=64), configuration_hash TEXT NOT NULL CHECK(length(configuration_hash)=64),
    completed_at INTEGER NOT NULL CHECK(typeof(completed_at)='integer' AND completed_at>=0),
    persisted_at INTEGER NOT NULL CHECK(typeof(persisted_at)='integer' AND persisted_at>=completed_at),
    content_hash TEXT NOT NULL CHECK(length(content_hash)=64), evidence_json TEXT NOT NULL);
    CREATE TABLE news_cached_analyses_v1 (
    configuration_hash TEXT NOT NULL, observation_id TEXT NOT NULL REFERENCES news_observations_v1(id),
    chunk_id TEXT NOT NULL REFERENCES news_analysis_chunks_v1(id),
    content_hash TEXT NOT NULL CHECK(length(content_hash)=64), evidence_json TEXT NOT NULL,
    PRIMARY KEY(configuration_hash, observation_id));`);
  for (const table of ['news_analysis_chunks_v1', 'news_cached_analyses_v1']) db.exec(`
    CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'news evidence is immutable'); END;
    CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'news evidence is immutable'); END;`);
} }];
