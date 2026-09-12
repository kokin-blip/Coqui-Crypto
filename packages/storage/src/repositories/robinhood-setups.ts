import type { Db } from '../sqlite/index.js';

export type RobinhoodSetupStatus = 'pending' | 'completed' | 'cancelled' | 'expired';

export interface RobinhoodConnectionSetupV1 {
  readonly id: string;
  readonly profileId: string;
  readonly publicKeyBase64: string;
  readonly status: RobinhoodSetupStatus;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly completedAtMs: number | null;
}

interface SetupRow {
  readonly id: string; readonly profile_id: string; readonly public_key_base64: string;
  readonly status: RobinhoodSetupStatus; readonly created_at_ms: number;
  readonly expires_at_ms: number; readonly completed_at_ms: number | null;
}

function view(row: SetupRow): RobinhoodConnectionSetupV1 {
  return Object.freeze({ id: row.id, profileId: row.profile_id, publicKeyBase64: row.public_key_base64,
    status: row.status, createdAtMs: row.created_at_ms, expiresAtMs: row.expires_at_ms,
    completedAtMs: row.completed_at_ms });
}

export function saveRobinhoodConnectionSetup(value: RobinhoodConnectionSetupV1, database: Db): void {
  database.prepare(`INSERT INTO robinhood_connection_setups_v1
    (id,profile_id,public_key_base64,status,created_at_ms,expires_at_ms,completed_at_ms)
    VALUES(?,?,?,?,?,?,?)`).run(value.id, value.profileId, value.publicKeyBase64, value.status,
      value.createdAtMs, value.expiresAtMs, value.completedAtMs);
}

export function getRobinhoodConnectionSetup(profileId: string, id: string, database: Db): RobinhoodConnectionSetupV1 | null {
  const row = database.prepare(`SELECT id,profile_id,public_key_base64,status,created_at_ms,expires_at_ms,completed_at_ms
    FROM robinhood_connection_setups_v1 WHERE profile_id=? AND id=?`).get(profileId, id) as SetupRow | undefined;
  return row === undefined ? null : view(row);
}

export function getLatestPendingRobinhoodConnectionSetup(profileId: string, atMs: number,
  database: Db): RobinhoodConnectionSetupV1 | null {
  const row = database.prepare(`SELECT id,profile_id,public_key_base64,status,created_at_ms,expires_at_ms,completed_at_ms
    FROM robinhood_connection_setups_v1
    WHERE profile_id=? AND status='pending' AND expires_at_ms>?
    ORDER BY created_at_ms DESC,id DESC LIMIT 1`).get(profileId, atMs) as SetupRow | undefined;
  return row === undefined ? null : view(row);
}

export function updateRobinhoodConnectionSetupStatus(profileId: string, id: string,
  expected: RobinhoodSetupStatus, status: RobinhoodSetupStatus, atMs: number, database: Db): boolean {
  const result = database.prepare(`UPDATE robinhood_connection_setups_v1 SET status=?,completed_at_ms=?
    WHERE profile_id=? AND id=? AND status=?`).run(status,
      status === 'completed' ? atMs : null, profileId, id, expected);
  return result.changes === 1;
}

export function listExpiredRobinhoodConnectionSetups(profileId: string, atMs: number, database: Db): readonly RobinhoodConnectionSetupV1[] {
  return (database.prepare(`SELECT id,profile_id,public_key_base64,status,created_at_ms,expires_at_ms,completed_at_ms
    FROM robinhood_connection_setups_v1 WHERE profile_id=? AND status='pending' AND expires_at_ms<=?`)
    .all(profileId, atMs) as unknown as SetupRow[]).map(view);
}
