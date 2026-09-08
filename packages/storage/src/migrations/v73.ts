import type { Migration } from './types.js';

export const migrations73: readonly Migration[] = [{
  version: 73,
  name: 'paper_connection_books_v1',
  up(db) {
    db.exec(`
      CREATE TABLE multi_connection_paper_campaigns_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64), profile_id TEXT NOT NULL,
        command_id TEXT NOT NULL, source_unified_snapshot_id TEXT NOT NULL,
        started_at INTEGER NOT NULL CHECK(started_at>=0), content_json TEXT NOT NULL CHECK(json_valid(content_json)),
        content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash)=64),
        UNIQUE(profile_id, command_id),
        FOREIGN KEY(source_unified_snapshot_id) REFERENCES unified_portfolio_snapshots_v2(id)
      );
      CREATE INDEX multi_connection_paper_campaigns_profile_time
        ON multi_connection_paper_campaigns_v1(profile_id, started_at DESC);
      CREATE TABLE paper_connection_book_snapshots_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64), campaign_id TEXT NOT NULL,
        profile_id TEXT NOT NULL, connection_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('coinbase','robinhood_crypto')),
        source_connection_snapshot_id TEXT NOT NULL, created_at INTEGER NOT NULL CHECK(created_at>=0),
        content_json TEXT NOT NULL CHECK(json_valid(content_json)), content_hash TEXT NOT NULL UNIQUE CHECK(length(content_hash)=64),
        UNIQUE(campaign_id, connection_id),
        FOREIGN KEY(campaign_id) REFERENCES multi_connection_paper_campaigns_v1(id),
        FOREIGN KEY(source_connection_snapshot_id) REFERENCES connection_account_snapshots_v2(id)
      );
      CREATE TABLE paper_connection_route_links_v1 (
        route_id TEXT PRIMARY KEY REFERENCES execution_routes_v1(id),
        campaign_id TEXT NOT NULL REFERENCES multi_connection_paper_campaigns_v1(id),
        book_snapshot_id TEXT NOT NULL REFERENCES paper_connection_book_snapshots_v1(id),
        connection_id TEXT NOT NULL, created_at INTEGER NOT NULL CHECK(created_at>=0)
      );
      CREATE TRIGGER multi_connection_paper_campaigns_v1_no_update BEFORE UPDATE ON multi_connection_paper_campaigns_v1
        BEGIN SELECT RAISE(ABORT,'multi-connection paper campaigns are immutable'); END;
      CREATE TRIGGER multi_connection_paper_campaigns_v1_no_delete BEFORE DELETE ON multi_connection_paper_campaigns_v1
        BEGIN SELECT RAISE(ABORT,'multi-connection paper campaigns are immutable'); END;
      CREATE TRIGGER paper_connection_book_snapshots_v1_no_update BEFORE UPDATE ON paper_connection_book_snapshots_v1
        BEGIN SELECT RAISE(ABORT,'paper connection books are immutable'); END;
      CREATE TRIGGER paper_connection_book_snapshots_v1_no_delete BEFORE DELETE ON paper_connection_book_snapshots_v1
        BEGIN SELECT RAISE(ABORT,'paper connection books are immutable'); END;
      CREATE TRIGGER paper_connection_route_links_v1_no_update BEFORE UPDATE ON paper_connection_route_links_v1
        BEGIN SELECT RAISE(ABORT,'paper connection route links are immutable'); END;
      CREATE TRIGGER paper_connection_route_links_v1_no_delete BEFORE DELETE ON paper_connection_route_links_v1
        BEGIN SELECT RAISE(ABORT,'paper connection route links are immutable'); END;
    `);
  },
}];
