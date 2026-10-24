import type { Migration } from './types.js';

export const migrations97: readonly Migration[] = [{ version: 97, name: 'capital_budget_feasibility_v1', up(db) {
  db.exec(`
    CREATE TABLE capital_native_rule_evidence_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), asset_id TEXT NOT NULL,
      observed_at_ms INTEGER NOT NULL, content_json TEXT NOT NULL CHECK(json_valid(content_json)),
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE TABLE capital_budget_source_evidence_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      observed_at_ms INTEGER NOT NULL, content_json TEXT NOT NULL CHECK(json_valid(content_json)),
      content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE TABLE capital_cash_claim_revisions_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      origin_key TEXT NOT NULL, replaces_id TEXT REFERENCES capital_cash_claim_revisions_v1(id),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
      CHECK(replaces_id IS NULL OR replaces_id<>id));
    CREATE TABLE capital_budget_reports_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      source_id TEXT NOT NULL REFERENCES capital_budget_source_evidence_v1(id),
      supersedes_id TEXT REFERENCES capital_budget_reports_v1(id),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE TABLE capital_feasibility_reports_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      budget_id TEXT NOT NULL REFERENCES capital_budget_reports_v1(id),
      supersedes_id TEXT REFERENCES capital_feasibility_reports_v1(id),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE TABLE capital_budget_checkpoints_v1 (
      scope_id TEXT PRIMARY KEY REFERENCES capital_scopes_v1(id),
      source_id TEXT NOT NULL REFERENCES capital_budget_source_evidence_v1(id),
      generation INTEGER NOT NULL CHECK(generation>=0), conflict INTEGER NOT NULL DEFAULT 0 CHECK(conflict IN (0,1)));
    CREATE TABLE capital_route_budget_bindings_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE INDEX capital_native_rules_asset_v1 ON capital_native_rule_evidence_v1(asset_id,observed_at_ms);
    CREATE INDEX capital_budget_source_scope_v1 ON capital_budget_source_evidence_v1(scope_id,observed_at_ms);
    CREATE INDEX capital_claim_origin_v1 ON capital_cash_claim_revisions_v1(scope_id,origin_key);
    CREATE INDEX capital_budget_report_scope_v1 ON capital_budget_reports_v1(scope_id);
    CREATE INDEX capital_feasibility_report_scope_v1 ON capital_feasibility_reports_v1(scope_id);
  `);
  for (const table of ['capital_native_rule_evidence_v1', 'capital_budget_source_evidence_v1', 'capital_cash_claim_revisions_v1',
    'capital_budget_reports_v1', 'capital_feasibility_reports_v1', 'capital_route_budget_bindings_v1']) {
    db.exec(`CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable capital budget evidence'); END;
      CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable capital budget evidence'); END;`);
  }
} }];
