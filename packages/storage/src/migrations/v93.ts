import type { Migration } from './types.js';
export const migrations93: readonly Migration[] = [{version:93,name:'scoped_news_export_permissions',up(db){
  db.exec(`CREATE TABLE news_export_permissions_v1 (
    id TEXT PRIMARY KEY CHECK(length(id)=64),profile_id TEXT NOT NULL,
    artifact_hash TEXT NOT NULL CHECK(length(artifact_hash)=64),reviewed_at INTEGER NOT NULL CHECK(reviewed_at>=0),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)),content_hash TEXT NOT NULL CHECK(length(content_hash)=64));
    CREATE INDEX news_export_permission_scope ON news_export_permissions_v1(profile_id,artifact_hash,reviewed_at);
    CREATE TRIGGER news_export_permissions_v1_no_update BEFORE UPDATE ON news_export_permissions_v1
      BEGIN SELECT RAISE(ABORT,'news export authority is immutable'); END;
    CREATE TRIGGER news_export_permissions_v1_no_delete BEFORE DELETE ON news_export_permissions_v1
      BEGIN SELECT RAISE(ABORT,'news export authority is immutable'); END;`);
}}];
