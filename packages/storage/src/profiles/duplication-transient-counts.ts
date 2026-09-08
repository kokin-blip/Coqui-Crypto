import type { Db } from '../sqlite/index.js';

function count(database: Db, sql: string, profileId: string, parameters: number): number {
  const row = database.prepare(sql).get(...Array.from({ length: parameters }, () => profileId)) as
    { count: number | bigint };
  const value = Number(row.count);
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid duplication exclusion count.');
  return value;
}

export function connectionCampaignRowCount(database: Db, profileId: string): number {
  return count(database, `SELECT
    (SELECT COUNT(*) FROM multi_connection_paper_campaigns_v1 WHERE profile_id=?) +
    (SELECT COUNT(*) FROM paper_connection_book_snapshots_v1 WHERE profile_id=?) +
    (SELECT COUNT(*) FROM paper_connection_route_links_v1 WHERE campaign_id IN
      (SELECT id FROM multi_connection_paper_campaigns_v1 WHERE profile_id=?)) AS count`, profileId, 3);
}

export function hostAuthorityRowCount(database: Db, profileId: string): number {
  return count(database, `SELECT
    (SELECT COUNT(*) FROM authoritative_hosts_v1 WHERE profile_id=?) +
    (SELECT COUNT(*) FROM host_reconciliation_evidence_v1 WHERE profile_id=?) +
    (SELECT COUNT(*) FROM host_takeover_history_v1 WHERE profile_id=?) AS count`, profileId, 3);
}
