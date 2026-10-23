import type { Migration } from './types.js';

export const migrations96: readonly Migration[] = [{ version: 96, name: 'capital_accounting_v1', up(db) {
  db.exec(`
    CREATE TABLE capital_scopes_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), provider TEXT NOT NULL, environment TEXT NOT NULL,
      account_identity_hash TEXT NOT NULL CHECK(length(account_identity_hash)=64), currency TEXT NOT NULL CHECK(currency='USD'),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
      UNIQUE(provider,environment,account_identity_hash,currency));
    CREATE TABLE capital_source_batches_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      observed_at_ms INTEGER NOT NULL CHECK(observed_at_ms>=0),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE TABLE capital_valuation_evidence_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      source_batch_id TEXT NOT NULL REFERENCES capital_source_batches_v1(id), replaces_id TEXT REFERENCES capital_valuation_evidence_v1(id),
      at_ms INTEGER NOT NULL CHECK(at_ms>=0),
      sequence INTEGER NOT NULL CHECK(sequence>=0), content_json TEXT NOT NULL CHECK(json_valid(content_json)),
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE TABLE capital_event_revisions_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      source_batch_id TEXT NOT NULL REFERENCES capital_source_batches_v1(id), logical_key TEXT NOT NULL,
      revision_hash TEXT NOT NULL CHECK(length(revision_hash)=64), replaces_id TEXT REFERENCES capital_event_revisions_v1(id),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
      UNIQUE(scope_id,logical_key,revision_hash), CHECK(replaces_id IS NULL OR replaces_id<>id));
    CREATE TABLE capital_tracking_epochs_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      opening_valuation_id TEXT NOT NULL REFERENCES capital_valuation_evidence_v1(id),
      predecessor_id TEXT REFERENCES capital_tracking_epochs_v1(id),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
      CHECK(predecessor_id IS NULL OR predecessor_id<>id));
    CREATE TABLE capital_performance_reports_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      epoch_id TEXT REFERENCES capital_tracking_epochs_v1(id), calculation_version TEXT NOT NULL,
      supersedes_id TEXT REFERENCES capital_performance_reports_v1(id),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE TABLE capital_scope_bindings_v1 (
      profile_id TEXT NOT NULL, scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id), connection_id TEXT,
      mode TEXT NOT NULL CHECK(mode IN ('active','archived','disconnected')),
      last_batch_id TEXT REFERENCES capital_source_batches_v1(id), PRIMARY KEY(profile_id,scope_id));
    CREATE INDEX capital_batches_scope ON capital_source_batches_v1(scope_id,observed_at_ms,id);
    CREATE INDEX capital_valuations_scope ON capital_valuation_evidence_v1(scope_id,at_ms,sequence,id);
    CREATE INDEX capital_events_scope ON capital_event_revisions_v1(scope_id,logical_key,id);
    CREATE INDEX capital_epochs_scope ON capital_tracking_epochs_v1(scope_id,id);
    CREATE INDEX capital_reports_scope ON capital_performance_reports_v1(scope_id);
  `);
  for (const table of ['capital_scopes_v1', 'capital_source_batches_v1', 'capital_valuation_evidence_v1',
    'capital_event_revisions_v1', 'capital_tracking_epochs_v1', 'capital_performance_reports_v1']) {
    for (const action of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER ${table}_no_${action.toLowerCase()}
      BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'capital facts are immutable'); END;`);
  }
} }];
