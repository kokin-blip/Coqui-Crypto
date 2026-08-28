import type { Migration } from './types.js';

/** Prospective observations and real-time paper campaign evidence. */
export const migrations50: readonly Migration[] = [{
  version: 50,
  name: 'forward_observations_and_paper_campaigns',
  up: (db) => {
    db.exec(`
      CREATE TABLE forward_edge_observations_v1 (
        id TEXT PRIMARY KEY,
        plan_hash TEXT NOT NULL REFERENCES forward_edge_study_plans_v1(plan_hash),
        profile_id TEXT NOT NULL,
        day_utc INTEGER NOT NULL CHECK (day_utc >= 0 AND day_utc % 86400000 = 0),
        run_id TEXT NOT NULL,
        observed_at INTEGER NOT NULL CHECK (observed_at >= day_utc),
        actual_equity_usd_text TEXT,
        hold_equity_usd_text TEXT,
        no_trade_equity_usd_text TEXT,
        turnover_usd_text TEXT NOT NULL,
        recorded_cost_usd_text TEXT NOT NULL,
        market_prices_json TEXT NOT NULL CHECK (json_valid(market_prices_json) AND json_type(market_prices_json) = 'object'),
        valuation_complete INTEGER NOT NULL CHECK (valuation_complete IN (0, 1)),
        state_hash TEXT NOT NULL CHECK (length(state_hash) = 64),
        provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
        evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
        UNIQUE (plan_hash, profile_id, day_utc),
        UNIQUE (plan_hash, profile_id, evidence_hash)
      );
      CREATE INDEX forward_edge_observations_v1_profile_day
        ON forward_edge_observations_v1(profile_id, day_utc);

      CREATE TABLE paper_campaign_plans_v1 (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('zero_edge_stand_down', 'validated_unattended')),
        start_day_utc INTEGER NOT NULL CHECK (start_day_utc >= 0 AND start_day_utc % 86400000 = 0),
        required_days INTEGER NOT NULL CHECK (required_days = 7),
        registered_at INTEGER NOT NULL CHECK (registered_at >= 0),
        plan_hash TEXT NOT NULL UNIQUE CHECK (length(plan_hash) = 64),
        UNIQUE (profile_id, kind, start_day_utc)
      );
      CREATE TABLE paper_campaign_events_v1 (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL REFERENCES paper_campaign_plans_v1(id),
        day_utc INTEGER NOT NULL CHECK (day_utc >= 0 AND day_utc % 86400000 = 0),
        run_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'observed', 'kill_switch_exercised', 'kill_switch_acknowledged', 'reconciled', 'failed'
        )),
        at INTEGER NOT NULL CHECK (at >= day_utc),
        evidence_hash TEXT NOT NULL CHECK (length(evidence_hash) = 64),
        detail_json TEXT NOT NULL CHECK (json_valid(detail_json) AND json_type(detail_json) = 'object'),
        UNIQUE (campaign_id, status, day_utc, run_id)
      );
      CREATE INDEX paper_campaign_events_v1_campaign_time
        ON paper_campaign_events_v1(campaign_id, day_utc, at);

      CREATE TRIGGER forward_edge_observations_v1_no_update BEFORE UPDATE ON forward_edge_observations_v1
        BEGIN SELECT RAISE(ABORT, 'forward observations are append-only'); END;
      CREATE TRIGGER forward_edge_observations_v1_no_delete BEFORE DELETE ON forward_edge_observations_v1
        BEGIN SELECT RAISE(ABORT, 'forward observations are append-only'); END;
      CREATE TRIGGER paper_campaign_plans_v1_no_update BEFORE UPDATE ON paper_campaign_plans_v1
        BEGIN SELECT RAISE(ABORT, 'paper campaign plans are immutable'); END;
      CREATE TRIGGER paper_campaign_plans_v1_no_delete BEFORE DELETE ON paper_campaign_plans_v1
        BEGIN SELECT RAISE(ABORT, 'paper campaign plans are immutable'); END;
      CREATE TRIGGER paper_campaign_events_v1_no_update BEFORE UPDATE ON paper_campaign_events_v1
        BEGIN SELECT RAISE(ABORT, 'paper campaign events are append-only'); END;
      CREATE TRIGGER paper_campaign_events_v1_no_delete BEFORE DELETE ON paper_campaign_events_v1
        BEGIN SELECT RAISE(ABORT, 'paper campaign events are append-only'); END;
    `);
  },
}];
