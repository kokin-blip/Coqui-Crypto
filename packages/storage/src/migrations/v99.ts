import type { Migration } from './types.js';
export const migrations99: readonly Migration[] = [{ version: 99, name: 'reviewed_internal_paper_reserves_v1', up(db) {
  db.exec(`CREATE TABLE paper_capital_book_origins_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), book_id TEXT NOT NULL UNIQUE, origin_profile_id TEXT NOT NULL UNIQUE,
    content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL);
  CREATE TABLE paper_reserve_requirements_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
    content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL);
  CREATE TABLE paper_reserve_policy_versions_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
    previous_id TEXT REFERENCES paper_reserve_policy_versions_v1(id), requirements_id TEXT NOT NULL REFERENCES paper_reserve_requirements_v1(id),
    content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL);
  CREATE TABLE paper_reserve_state_revisions_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id), stream_id TEXT NOT NULL,
    policy_id TEXT NOT NULL REFERENCES paper_reserve_policy_versions_v1(id), previous_id TEXT REFERENCES paper_reserve_state_revisions_v1(id),
    operation_key TEXT NOT NULL, content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL, UNIQUE(stream_id,operation_key));
  CREATE TABLE paper_reserve_proposals_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
    state_id TEXT NOT NULL REFERENCES paper_reserve_state_revisions_v1(id), policy_id TEXT NOT NULL REFERENCES paper_reserve_policy_versions_v1(id),
    content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL);
  CREATE TABLE paper_reserve_assessments_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id), stream_id TEXT NOT NULL, operation_key TEXT NOT NULL,
    proposal_id TEXT NOT NULL REFERENCES paper_reserve_proposals_v1(id), before_id TEXT NOT NULL REFERENCES paper_reserve_state_revisions_v1(id),
    after_id TEXT NOT NULL REFERENCES paper_reserve_state_revisions_v1(id), content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL, UNIQUE(stream_id,operation_key));
  CREATE TABLE paper_reserve_events_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id),
    content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL);
  CREATE TABLE paper_reserve_commands_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64), scope_id TEXT NOT NULL REFERENCES capital_scopes_v1(id), command_id TEXT NOT NULL,
    content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL, UNIQUE(scope_id,command_id));
  CREATE TABLE paper_reserve_runtime_bindings_v1 (
    profile_id TEXT PRIMARY KEY, book_id TEXT NOT NULL UNIQUE REFERENCES paper_capital_book_origins_v1(id), scope_id TEXT NOT NULL UNIQUE REFERENCES capital_scopes_v1(id),
    policy_id TEXT REFERENCES paper_reserve_policy_versions_v1(id), state_id TEXT REFERENCES paper_reserve_state_revisions_v1(id), requirements_id TEXT REFERENCES paper_reserve_requirements_v1(id),
    generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0), archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)), disabled INTEGER NOT NULL DEFAULT 1 CHECK(disabled IN(0,1)));
  `);
  for (const table of ['paper_capital_book_origins_v1','paper_reserve_requirements_v1','paper_reserve_policy_versions_v1','paper_reserve_state_revisions_v1','paper_reserve_proposals_v1','paper_reserve_assessments_v1','paper_reserve_events_v1','paper_reserve_commands_v1']) {
    db.exec(`CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable paper reserve evidence'); END;
      CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable paper reserve evidence'); END;`);
    if (table !== 'paper_capital_book_origins_v1') db.exec(`CREATE INDEX ${table}_scope ON ${table}(scope_id);`);
  }
} }];
