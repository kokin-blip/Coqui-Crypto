import type { Migration } from './types.js';

/** Append-only operational funnel evidence and explicit immutable report associations. */
export const migrations92: readonly Migration[] = [{ version: 92, name: 'news_diagnostics_and_reports_v1', up(db) {
  db.exec(`CREATE TABLE news_ingestion_diagnostics_v1 (
    id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL,
    completed_at INTEGER NOT NULL CHECK(completed_at>=0),
    ok INTEGER NOT NULL CHECK(ok IN (0,1)), reason TEXT,
    parsed INTEGER NOT NULL CHECK(parsed>=0), retained INTEGER NOT NULL CHECK(retained>=0),
    inserted INTEGER NOT NULL CHECK(inserted>=0), request_cost INTEGER NOT NULL CHECK(request_cost>=0));
    CREATE INDEX news_diagnostics_provider_time ON news_ingestion_diagnostics_v1(provider,completed_at);
    CREATE TABLE news_report_associations_v1 (
    report_hash TEXT NOT NULL, profile_id TEXT NOT NULL, associated_at INTEGER NOT NULL,
    report_path TEXT NOT NULL, PRIMARY KEY(report_hash,profile_id));`);
  for (const table of ['news_ingestion_diagnostics_v1', 'news_report_associations_v1']) db.exec(`
    CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'news evidence is immutable'); END;
    CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'news evidence is immutable'); END;`);
} }];
