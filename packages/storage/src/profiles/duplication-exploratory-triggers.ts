import type { Db } from '../sqlite/index.js';

export function dropExploratoryDuplicationTriggers(database: Db): void {
  database.exec(`
    DROP TRIGGER exploratory_paper_campaigns_v1_no_update;
    DROP TRIGGER exploratory_paper_campaigns_v1_no_delete;
    DROP TRIGGER exploratory_paper_campaign_events_v1_no_update;
    DROP TRIGGER exploratory_paper_campaign_events_v1_no_delete;
    DROP TRIGGER exploratory_paper_ledger_entries_v1_no_update;
    DROP TRIGGER exploratory_paper_ledger_entries_v1_no_delete;
    DROP TRIGGER exploratory_paper_execution_links_v1_no_update;
    DROP TRIGGER exploratory_paper_execution_links_v1_no_delete;
    DROP TRIGGER exploratory_paper_valuations_v1_no_update;
    DROP TRIGGER exploratory_paper_valuations_v1_no_delete;
  `);
}

export function deleteExploratoryCampaignRows(database: Db): void {
  database.exec(`
    DELETE FROM exploratory_paper_valuations_v1;
    DELETE FROM exploratory_paper_execution_links_v1;
    DELETE FROM exploratory_paper_ledger_entries_v1;
    DELETE FROM exploratory_paper_balances_v1;
    DELETE FROM exploratory_paper_campaign_state_v1;
    DELETE FROM exploratory_paper_campaign_events_v1;
    DELETE FROM exploratory_paper_campaigns_v1;
  `);
}

export function restoreExploratoryDuplicationTriggers(database: Db): void {
  database.exec(`
    CREATE TRIGGER exploratory_paper_campaigns_v1_no_update BEFORE UPDATE ON exploratory_paper_campaigns_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper campaigns are immutable'); END;
    CREATE TRIGGER exploratory_paper_campaigns_v1_no_delete BEFORE DELETE ON exploratory_paper_campaigns_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper campaigns are immutable'); END;
    CREATE TRIGGER exploratory_paper_campaign_events_v1_no_update BEFORE UPDATE ON exploratory_paper_campaign_events_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper campaign events are append-only'); END;
    CREATE TRIGGER exploratory_paper_campaign_events_v1_no_delete BEFORE DELETE ON exploratory_paper_campaign_events_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper campaign events are append-only'); END;
    CREATE TRIGGER exploratory_paper_ledger_entries_v1_no_update BEFORE UPDATE ON exploratory_paper_ledger_entries_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper ledger is append-only'); END;
    CREATE TRIGGER exploratory_paper_ledger_entries_v1_no_delete BEFORE DELETE ON exploratory_paper_ledger_entries_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper ledger is append-only'); END;
    CREATE TRIGGER exploratory_paper_execution_links_v1_no_update BEFORE UPDATE ON exploratory_paper_execution_links_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper links are immutable'); END;
    CREATE TRIGGER exploratory_paper_execution_links_v1_no_delete BEFORE DELETE ON exploratory_paper_execution_links_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper links are immutable'); END;
    CREATE TRIGGER exploratory_paper_valuations_v1_no_update BEFORE UPDATE ON exploratory_paper_valuations_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper valuations are immutable'); END;
    CREATE TRIGGER exploratory_paper_valuations_v1_no_delete BEFORE DELETE ON exploratory_paper_valuations_v1
      BEGIN SELECT RAISE(ABORT,'exploratory paper valuations are immutable'); END;
  `);
}
