import type { Migration } from './types.js';

export const migrations85: readonly Migration[] = [{ version: 85, name: 'remediation_evidence_v1', up(db) {
  db.exec(`CREATE TABLE remediation_evidence_v1 (
    profile_id TEXT NOT NULL, namespace TEXT NOT NULL, kind TEXT NOT NULL, record_key TEXT NOT NULL,
    at_ms INTEGER NOT NULL, content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)),
    PRIMARY KEY(profile_id,namespace,kind,record_key)
  );
  CREATE INDEX remediation_evidence_time ON remediation_evidence_v1(profile_id,namespace,kind,at_ms);
  CREATE TRIGGER remediation_evidence_no_update BEFORE UPDATE ON remediation_evidence_v1
    BEGIN SELECT RAISE(ABORT,'remediation evidence is immutable'); END;
  CREATE TRIGGER remediation_evidence_no_delete BEFORE DELETE ON remediation_evidence_v1
    BEGIN SELECT RAISE(ABORT,'remediation evidence is immutable'); END;`);
} }];
