import type { Migration } from './types.js';

export const migrations77: readonly Migration[] = [{
  version: 77,
  name: 'exploratory_paper_campaigns_v1',
  up(db) {
    db.exec(`
      CREATE TABLE exploratory_paper_campaigns_v1 (
        campaign_id TEXT PRIMARY KEY CHECK(length(campaign_id)=64),
        profile_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        source_portfolio_snapshot_id TEXT NOT NULL REFERENCES unified_portfolio_snapshots_v2(id),
        started_at INTEGER NOT NULL CHECK(started_at>=0),
        content_json TEXT NOT NULL CHECK(json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash)=64),
        UNIQUE(profile_id,command_id)
      );
      CREATE INDEX exploratory_paper_campaigns_profile_time
        ON exploratory_paper_campaigns_v1(profile_id,started_at DESC,campaign_id);

      CREATE TABLE exploratory_paper_campaign_events_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        campaign_id TEXT NOT NULL REFERENCES exploratory_paper_campaigns_v1(campaign_id),
        profile_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK(sequence>=0),
        kind TEXT NOT NULL CHECK(kind IN ('started','paused','resumed','stopping','stopped')),
        at INTEGER NOT NULL CHECK(at>=0),
        detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
        UNIQUE(campaign_id,sequence),
        UNIQUE(profile_id,command_id)
      );
      CREATE INDEX exploratory_paper_campaign_events_profile_time
        ON exploratory_paper_campaign_events_v1(profile_id,at DESC,id);

      CREATE TABLE exploratory_paper_campaign_state_v1 (
        profile_id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL UNIQUE REFERENCES exploratory_paper_campaigns_v1(campaign_id),
        status TEXT NOT NULL CHECK(status IN ('active','paused','stopping','stopped')),
        revision INTEGER NOT NULL CHECK(revision>=0),
        updated_at INTEGER NOT NULL CHECK(updated_at>=0)
      );

      CREATE TABLE exploratory_paper_balances_v1 (
        campaign_id TEXT NOT NULL REFERENCES exploratory_paper_campaigns_v1(campaign_id),
        profile_id TEXT NOT NULL,
        exposure_key TEXT NOT NULL,
        asset_id TEXT,
        quantity_text TEXT NOT NULL,
        managed INTEGER NOT NULL CHECK(managed IN (0,1)),
        updated_at INTEGER NOT NULL CHECK(updated_at>=0),
        PRIMARY KEY(campaign_id,exposure_key),
        CHECK((managed=1 AND asset_id IS NOT NULL) OR (managed=0 AND asset_id IS NULL))
      );
      CREATE INDEX exploratory_paper_balances_profile_campaign
        ON exploratory_paper_balances_v1(profile_id,campaign_id,exposure_key);

      CREATE TABLE exploratory_paper_ledger_entries_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        campaign_id TEXT NOT NULL REFERENCES exploratory_paper_campaigns_v1(campaign_id),
        profile_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        order_id TEXT,
        fill_id TEXT,
        account TEXT NOT NULL CHECK(account IN ('opening','cash','asset','venue_fee')),
        exposure_key TEXT,
        asset_id TEXT,
        amount_usd_text TEXT NOT NULL,
        quantity_text TEXT NOT NULL,
        at INTEGER NOT NULL CHECK(at>=0),
        detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
        CHECK(account='opening' OR order_id IS NOT NULL)
      );
      CREATE INDEX exploratory_paper_ledger_campaign_time
        ON exploratory_paper_ledger_entries_v1(campaign_id,at,id);

      CREATE TABLE exploratory_paper_execution_links_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        campaign_id TEXT NOT NULL REFERENCES exploratory_paper_campaigns_v1(campaign_id),
        profile_id TEXT NOT NULL,
        decision_id TEXT REFERENCES strategy_decisions_v1(decision_id),
        proposal_id TEXT REFERENCES paper_execution_proposals_v1(id),
        order_id TEXT REFERENCES paper_orders_v3(id),
        pending_id TEXT REFERENCES paper_pending_executions_v1(id),
        fill_id TEXT REFERENCES paper_fills_v3(id),
        created_at INTEGER NOT NULL CHECK(created_at>=0),
        content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash)=64),
        CHECK(decision_id IS NOT NULL OR proposal_id IS NOT NULL OR order_id IS NOT NULL OR pending_id IS NOT NULL OR fill_id IS NOT NULL)
      );
      CREATE INDEX exploratory_paper_execution_links_campaign
        ON exploratory_paper_execution_links_v1(campaign_id,created_at,id);

      CREATE TABLE exploratory_paper_valuations_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        campaign_id TEXT NOT NULL REFERENCES exploratory_paper_campaigns_v1(campaign_id),
        profile_id TEXT NOT NULL,
        as_of INTEGER NOT NULL CHECK(as_of>=0),
        equity_usd_text TEXT,
        benchmark_usd_text TEXT,
        estimated_costs_usd_text TEXT NOT NULL,
        unpriced_count INTEGER NOT NULL CHECK(unpriced_count>=0),
        content_json TEXT NOT NULL CHECK(json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash)=64),
        UNIQUE(campaign_id,as_of)
      );
      CREATE INDEX exploratory_paper_valuations_campaign_time
        ON exploratory_paper_valuations_v1(campaign_id,as_of,id);

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

      CREATE TRIGGER exploratory_paper_campaigns_v1_profile_guard
      BEFORE INSERT ON exploratory_paper_campaigns_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM unified_portfolio_snapshots_v2 source
        WHERE source.id=NEW.source_portfolio_snapshot_id AND source.profile_id=NEW.profile_id
      ) BEGIN SELECT RAISE(ABORT,'exploratory campaign source profile mismatch'); END;
      CREATE TRIGGER exploratory_paper_events_v1_profile_guard
      BEFORE INSERT ON exploratory_paper_campaign_events_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM exploratory_paper_campaigns_v1 campaign
        WHERE campaign.campaign_id=NEW.campaign_id AND campaign.profile_id=NEW.profile_id
      ) BEGIN SELECT RAISE(ABORT,'exploratory campaign event profile mismatch'); END;
      CREATE TRIGGER exploratory_paper_state_v1_profile_guard
      BEFORE INSERT ON exploratory_paper_campaign_state_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM exploratory_paper_campaigns_v1 campaign
        WHERE campaign.campaign_id=NEW.campaign_id AND campaign.profile_id=NEW.profile_id
      ) BEGIN SELECT RAISE(ABORT,'exploratory campaign state profile mismatch'); END;
      CREATE TRIGGER exploratory_paper_state_v1_update_profile_guard
      BEFORE UPDATE ON exploratory_paper_campaign_state_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM exploratory_paper_campaigns_v1 campaign
        WHERE campaign.campaign_id=NEW.campaign_id AND campaign.profile_id=NEW.profile_id
      ) BEGIN SELECT RAISE(ABORT,'exploratory campaign state profile mismatch'); END;
      CREATE TRIGGER exploratory_paper_balances_v1_profile_guard
      BEFORE INSERT ON exploratory_paper_balances_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM exploratory_paper_campaigns_v1 campaign
        WHERE campaign.campaign_id=NEW.campaign_id AND campaign.profile_id=NEW.profile_id
      ) BEGIN SELECT RAISE(ABORT,'exploratory balance profile mismatch'); END;
      CREATE TRIGGER exploratory_paper_ledger_v1_profile_guard
      BEFORE INSERT ON exploratory_paper_ledger_entries_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM exploratory_paper_campaigns_v1 campaign
        WHERE campaign.campaign_id=NEW.campaign_id AND campaign.profile_id=NEW.profile_id
      ) BEGIN SELECT RAISE(ABORT,'exploratory ledger profile mismatch'); END;
      CREATE TRIGGER exploratory_paper_links_v1_profile_guard
      BEFORE INSERT ON exploratory_paper_execution_links_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM exploratory_paper_campaigns_v1 campaign
        WHERE campaign.campaign_id=NEW.campaign_id AND campaign.profile_id=NEW.profile_id
      ) BEGIN SELECT RAISE(ABORT,'exploratory execution link profile mismatch'); END;
      CREATE TRIGGER exploratory_paper_valuations_v1_profile_guard
      BEFORE INSERT ON exploratory_paper_valuations_v1
      WHEN NOT EXISTS (
        SELECT 1 FROM exploratory_paper_campaigns_v1 campaign
        WHERE campaign.campaign_id=NEW.campaign_id AND campaign.profile_id=NEW.profile_id
      ) BEGIN SELECT RAISE(ABORT,'exploratory valuation profile mismatch'); END;
    `);
  },
}];
