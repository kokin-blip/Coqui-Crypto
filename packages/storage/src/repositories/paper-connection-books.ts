import {
  canonicalJson,
  paperConnectionBookHash,
  type CanonicalJsonValue,
  type MultiConnectionPaperCampaignV1,
  type PaperConnectionBookSnapshotV1,
} from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

const SHA256 = /^[0-9a-f]{64}$/u;

function json(value: unknown): string { return canonicalJson(value as CanonicalJsonValue); }

export function saveMultiConnectionPaperCampaign(
  campaign: MultiConnectionPaperCampaignV1,
  books: readonly PaperConnectionBookSnapshotV1[],
  database: Db,
): void {
  if (paperConnectionBookHash(campaign) !== campaign.contentHash || books.length === 0 ||
      books.some((book) => book.campaignId !== campaign.id || book.profileId !== campaign.profileId ||
        paperConnectionBookHash(book) !== book.contentHash)) throw new TypeError('Invalid paper connection campaign evidence.');
  inTransaction(database, () => {
    database.prepare(`INSERT OR IGNORE INTO multi_connection_paper_campaigns_v1
      (id,profile_id,command_id,source_unified_snapshot_id,started_at,content_json,content_hash)
      VALUES(?,?,?,?,?,?,?)`).run(campaign.id, campaign.profileId, campaign.commandId,
      campaign.sourceUnifiedSnapshotId, campaign.startedAtMs, json(campaign), campaign.contentHash);
    const insert = database.prepare(`INSERT OR IGNORE INTO paper_connection_book_snapshots_v1
      (id,campaign_id,profile_id,connection_id,provider,source_connection_snapshot_id,created_at,content_json,content_hash)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const book of books) insert.run(book.id, book.campaignId, book.profileId, book.connectionId,
      book.provider, book.sourceConnectionSnapshotId, book.createdAtMs, json(book), book.contentHash);
  });
}

export function getMultiConnectionPaperCampaignByCommand(
  profileId: string, commandId: string, database: Db,
): MultiConnectionPaperCampaignV1 | null {
  const row = database.prepare(`SELECT content_json FROM multi_connection_paper_campaigns_v1
    WHERE profile_id=? AND command_id=?`).get(profileId, commandId) as { content_json: string } | undefined;
  return row === undefined ? null : JSON.parse(row.content_json) as MultiConnectionPaperCampaignV1;
}

export function latestMultiConnectionPaperCampaign(profileId: string, database: Db): {
  readonly campaign: MultiConnectionPaperCampaignV1; readonly books: readonly PaperConnectionBookSnapshotV1[];
} | null {
  const row = database.prepare(`SELECT content_json FROM multi_connection_paper_campaigns_v1
    WHERE profile_id=? ORDER BY started_at DESC,id DESC LIMIT 1`).get(profileId) as { content_json: string } | undefined;
  if (row === undefined) return null;
  const campaign = JSON.parse(row.content_json) as MultiConnectionPaperCampaignV1;
  const books = paperConnectionBooks(campaign.id, database);
  return Object.freeze({ campaign: Object.freeze(campaign), books: Object.freeze(books) });
}

export function paperConnectionBooks(
  campaignId: string, database: Db,
): readonly PaperConnectionBookSnapshotV1[] {
  return Object.freeze((database.prepare(`SELECT content_json FROM paper_connection_book_snapshots_v1
    WHERE campaign_id=? ORDER BY provider,connection_id`).all(campaignId) as { content_json: string }[])
    .map((item) => Object.freeze(JSON.parse(item.content_json) as PaperConnectionBookSnapshotV1)));
}

export function linkPaperConnectionRoute(input: {
  readonly profileId: string;
  readonly routeId: string;
  readonly campaignId: string;
  readonly bookSnapshotId: string;
  readonly connectionId: string;
  readonly createdAtMs: number;
}, database: Db): void {
  if (!input.profileId || !SHA256.test(input.routeId) || !SHA256.test(input.campaignId) ||
      !SHA256.test(input.bookSnapshotId) || !input.connectionId ||
      !Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0) {
    throw new TypeError('Invalid paper connection route link.');
  }
  const owned = database.prepare(`SELECT 1 AS owned FROM execution_routes_v1 route
    JOIN paper_connection_book_snapshots_v1 book ON book.id=?
    WHERE route.id=? AND route.profile_id=? AND route.connection_id=?
      AND book.profile_id=route.profile_id AND book.connection_id=route.connection_id
      AND book.campaign_id=?`).get(input.bookSnapshotId, input.routeId, input.profileId,
    input.connectionId, input.campaignId) as { owned: number } | undefined;
  if (owned === undefined) throw new Error('Paper connection route ownership mismatch.');
  database.prepare(`INSERT INTO paper_connection_route_links_v1
    (route_id,campaign_id,book_snapshot_id,connection_id,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(route_id) DO NOTHING`).run(input.routeId, input.campaignId,
    input.bookSnapshotId, input.connectionId, input.createdAtMs);
  const stored = database.prepare(`SELECT campaign_id,book_snapshot_id,connection_id,created_at
    FROM paper_connection_route_links_v1 WHERE route_id=?`).get(input.routeId) as
    { campaign_id: string; book_snapshot_id: string; connection_id: string; created_at: number };
  if (stored.campaign_id !== input.campaignId || stored.book_snapshot_id !== input.bookSnapshotId ||
      stored.connection_id !== input.connectionId || stored.created_at !== input.createdAtMs) {
    throw new Error('Paper connection route link cannot change.');
  }
}
