import type { Migration } from './types.js';
export const migrations98: readonly Migration[] = [{version:98,name:'profit_reserve_preview_v1',up(db){
  db.exec(`
    CREATE TABLE capital_reserve_policy_versions_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      previous_id TEXT REFERENCES capital_reserve_policy_versions_v1(id), content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL);
    CREATE TABLE capital_reserve_eligibility_reports_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id), supersedes_id TEXT REFERENCES capital_reserve_eligibility_reports_v1(id),
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL);
    CREATE TABLE capital_reserve_state_revisions_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id), stream_id TEXT NOT NULL,
      policy_id TEXT NOT NULL REFERENCES capital_reserve_policy_versions_v1(id), previous_id TEXT REFERENCES capital_reserve_state_revisions_v1(id), operation_key TEXT NOT NULL,
      domain TEXT NOT NULL CHECK(domain='preview'), content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL,
      UNIQUE(stream_id,operation_key));
    CREATE TABLE capital_reserve_preview_reports_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
      policy_id TEXT NOT NULL REFERENCES capital_reserve_policy_versions_v1(id), state_id TEXT NOT NULL REFERENCES capital_reserve_state_revisions_v1(id),
      supersedes_id TEXT REFERENCES capital_reserve_preview_reports_v1(id), content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL);
    CREATE TABLE capital_reserve_assessments_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id), stream_id TEXT NOT NULL, operation_key TEXT NOT NULL,
      before_id TEXT NOT NULL REFERENCES capital_reserve_state_revisions_v1(id), after_id TEXT NOT NULL REFERENCES capital_reserve_state_revisions_v1(id),
      domain TEXT NOT NULL CHECK(domain='preview'), content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL,
      UNIQUE(stream_id,operation_key));
    CREATE TABLE capital_reserve_preview_heads_v1 (
      scope_id TEXT PRIMARY KEY REFERENCES capital_scopes_v1(id), policy_id TEXT NOT NULL REFERENCES capital_reserve_policy_versions_v1(id),
      state_id TEXT NOT NULL REFERENCES capital_reserve_state_revisions_v1(id), generation INTEGER NOT NULL CHECK(generation>=0),
      archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)));
    CREATE TABLE capital_reserve_commands_v1 (
      id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id), command_id TEXT NOT NULL,
      content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL, UNIQUE(scope_id,command_id));
  `);
  for(const table of ['capital_reserve_policy_versions_v1','capital_reserve_eligibility_reports_v1','capital_reserve_state_revisions_v1',
    'capital_reserve_preview_reports_v1','capital_reserve_assessments_v1','capital_reserve_commands_v1'])db.exec(`
      CREATE INDEX ${table}_scope ON ${table}(scope_id);
      CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable reserve preview evidence'); END;
      CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable reserve preview evidence'); END;`);
}}];
