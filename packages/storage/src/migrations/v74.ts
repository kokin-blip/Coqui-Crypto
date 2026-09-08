import type { Migration } from './types.js';

export const migrations74: readonly Migration[] = [{
  version: 74,
  name: 'decision_asset_evidence_v1',
  up(db) {
    db.exec(`
      CREATE TABLE decision_asset_links_v1 (
        decision_id TEXT NOT NULL, profile_id TEXT NOT NULL,
        asset_scope TEXT NOT NULL CHECK(length(asset_scope) BETWEEN 1 AND 32),
        source TEXT NOT NULL CHECK(source IN ('target','momentum','global')),
        PRIMARY KEY(decision_id,asset_scope),
        FOREIGN KEY(decision_id,profile_id) REFERENCES strategy_decisions_v1(decision_id,profile_id)
      );
      CREATE INDEX decision_asset_links_v1_profile_asset
        ON decision_asset_links_v1(profile_id,asset_scope,decision_id);
      CREATE TABLE decision_evidence_asset_links_v1 (
        event_id TEXT NOT NULL REFERENCES decision_evidence_events_v1(id),
        decision_id TEXT NOT NULL, profile_id TEXT NOT NULL,
        asset_scope TEXT NOT NULL CHECK(length(asset_scope) BETWEEN 1 AND 32),
        PRIMARY KEY(event_id,asset_scope),
        FOREIGN KEY(decision_id,asset_scope)
          REFERENCES decision_asset_links_v1(decision_id,asset_scope)
      );
      CREATE INDEX decision_evidence_asset_links_v1_profile_asset
        ON decision_evidence_asset_links_v1(profile_id,asset_scope,event_id);
      CREATE TRIGGER decision_asset_links_v1_no_update BEFORE UPDATE ON decision_asset_links_v1
        BEGIN SELECT RAISE(ABORT,'decision asset links are immutable'); END;
      CREATE TRIGGER decision_asset_links_v1_no_delete BEFORE DELETE ON decision_asset_links_v1
        BEGIN SELECT RAISE(ABORT,'decision asset links are immutable'); END;
      CREATE TRIGGER decision_evidence_asset_links_v1_no_update BEFORE UPDATE ON decision_evidence_asset_links_v1
        BEGIN SELECT RAISE(ABORT,'decision evidence asset links are immutable'); END;
      CREATE TRIGGER decision_evidence_asset_links_v1_no_delete BEFORE DELETE ON decision_evidence_asset_links_v1
        BEGIN SELECT RAISE(ABORT,'decision evidence asset links are immutable'); END;
      CREATE TRIGGER decision_evidence_asset_links_v1_identity_guard
      BEFORE INSERT ON decision_evidence_asset_links_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM decision_evidence_events_v1 event
        WHERE event.id=NEW.event_id AND event.decision_id=NEW.decision_id
          AND event.profile_id=NEW.profile_id
      )
      BEGIN SELECT RAISE(ABORT,'decision evidence asset identity mismatch'); END;

      INSERT INTO decision_asset_links_v1(decision_id,profile_id,asset_scope,source)
      SELECT decision_id,profile_id,'GLOBAL','global' FROM strategy_decisions_v1;
      INSERT INTO decision_evidence_asset_links_v1(event_id,decision_id,profile_id,asset_scope)
      SELECT id,decision_id,profile_id,'GLOBAL' FROM decision_evidence_events_v1;
    `);
  },
}];
