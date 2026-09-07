import type { Migration } from './types.js';

export const migrations70: readonly Migration[] = [{
  version: 70,
  name: 'local_authoritative_hosts_v1',
  up(db) {
    db.exec(`
      CREATE TABLE host_reconciliation_evidence_v1 (
        id TEXT PRIMARY KEY CHECK (length(id)=64),
        profile_id TEXT NOT NULL,
        host_id TEXT NOT NULL,
        observed_generation INTEGER NOT NULL CHECK (observed_generation>=0),
        at INTEGER NOT NULL CHECK (at>=0),
        detail_json TEXT NOT NULL CHECK (json_valid(detail_json) AND json_type(detail_json)='object'),
        detail_hash TEXT NOT NULL CHECK (length(detail_hash)=64)
      );
      CREATE INDEX host_reconciliation_evidence_v1_profile_time
        ON host_reconciliation_evidence_v1(profile_id,at DESC,id);

      CREATE TABLE authoritative_hosts_v1 (
        profile_id TEXT PRIMARY KEY,
        host_id TEXT,
        host_kind TEXT CHECK (host_kind IN ('desktop','headless')),
        fencing_generation INTEGER NOT NULL CHECK (fencing_generation>=0),
        status TEXT NOT NULL CHECK (status IN ('active','relinquished')),
        assigned_at INTEGER NOT NULL CHECK (assigned_at>=0),
        heartbeat_at INTEGER,
        reconciliation_id TEXT REFERENCES host_reconciliation_evidence_v1(id),
        CHECK ((status='active')=(host_id IS NOT NULL)),
        CHECK ((host_id IS NULL)=(host_kind IS NULL))
      );

      CREATE TABLE host_takeover_history_v1 (
        id TEXT PRIMARY KEY CHECK (length(id)=64),
        profile_id TEXT NOT NULL,
        prior_host_id TEXT,
        next_host_id TEXT,
        action TEXT NOT NULL CHECK (action IN ('assigned','takeover','relinquished')),
        fencing_generation INTEGER NOT NULL CHECK (fencing_generation>0),
        reconciliation_id TEXT REFERENCES host_reconciliation_evidence_v1(id),
        at INTEGER NOT NULL CHECK (at>=0)
      );
      CREATE INDEX host_takeover_history_v1_profile_generation
        ON host_takeover_history_v1(profile_id,fencing_generation DESC,id);

      CREATE TRIGGER host_reconciliation_evidence_v1_no_update BEFORE UPDATE ON host_reconciliation_evidence_v1
        BEGIN SELECT RAISE(ABORT,'host reconciliation evidence is immutable'); END;
      CREATE TRIGGER host_reconciliation_evidence_v1_no_delete BEFORE DELETE ON host_reconciliation_evidence_v1
        BEGIN SELECT RAISE(ABORT,'host reconciliation evidence is immutable'); END;
      CREATE TRIGGER host_takeover_history_v1_no_update BEFORE UPDATE ON host_takeover_history_v1
        BEGIN SELECT RAISE(ABORT,'host takeover history is immutable'); END;
      CREATE TRIGGER host_takeover_history_v1_no_delete BEFORE DELETE ON host_takeover_history_v1
        BEGIN SELECT RAISE(ABORT,'host takeover history is immutable'); END;
    `);
  },
}];
