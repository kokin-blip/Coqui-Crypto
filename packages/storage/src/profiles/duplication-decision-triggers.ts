import type { Db } from '../sqlite/index.js';

export function dropDecisionDuplicationTriggers(database: Db): void {
  database.exec(`
    DROP TRIGGER strategy_decisions_v1_no_update; DROP TRIGGER strategy_decisions_v1_no_delete;
    DROP TRIGGER decision_evidence_events_v1_no_update; DROP TRIGGER decision_evidence_events_v1_no_delete;
    DROP TRIGGER decision_asset_links_v1_no_update; DROP TRIGGER decision_asset_links_v1_no_delete;
    DROP TRIGGER decision_evidence_asset_links_v1_no_update; DROP TRIGGER decision_evidence_asset_links_v1_no_delete;
  `);
}

export function restoreDecisionDuplicationTriggers(database: Db): void {
  database.exec(`
    CREATE TRIGGER strategy_decisions_v1_no_update BEFORE UPDATE ON strategy_decisions_v1
      BEGIN SELECT RAISE(ABORT,'strategy decisions are immutable'); END;
    CREATE TRIGGER strategy_decisions_v1_no_delete BEFORE DELETE ON strategy_decisions_v1
      BEGIN SELECT RAISE(ABORT,'strategy decisions are immutable'); END;
    CREATE TRIGGER decision_evidence_events_v1_no_update BEFORE UPDATE ON decision_evidence_events_v1
      BEGIN SELECT RAISE(ABORT,'decision evidence events are append-only'); END;
    CREATE TRIGGER decision_evidence_events_v1_no_delete BEFORE DELETE ON decision_evidence_events_v1
      BEGIN SELECT RAISE(ABORT,'decision evidence events are append-only'); END;
    CREATE TRIGGER decision_asset_links_v1_no_update BEFORE UPDATE ON decision_asset_links_v1
      BEGIN SELECT RAISE(ABORT,'decision asset links are immutable'); END;
    CREATE TRIGGER decision_asset_links_v1_no_delete BEFORE DELETE ON decision_asset_links_v1
      BEGIN SELECT RAISE(ABORT,'decision asset links are immutable'); END;
    CREATE TRIGGER decision_evidence_asset_links_v1_no_update BEFORE UPDATE ON decision_evidence_asset_links_v1
      BEGIN SELECT RAISE(ABORT,'decision evidence asset links are immutable'); END;
    CREATE TRIGGER decision_evidence_asset_links_v1_no_delete BEFORE DELETE ON decision_evidence_asset_links_v1
      BEGIN SELECT RAISE(ABORT,'decision evidence asset links are immutable'); END;
  `);
}
