import { sha256Hex } from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';
import { isAuthoritativeHost } from './host-authority.js';

const PROFILE_ID = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;

export interface ExecutionLease {
  readonly profileId: string;
  readonly ownerId: string | null;
  readonly leasedUntilMs: number | null;
  readonly fencingToken: number;
  readonly updatedAtMs: number;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function read(profileId: string, database: Db): ExecutionLease | null {
  const row = database.prepare('SELECT * FROM execution_leases_v1 WHERE profile_id = ?')
    .get(profileId) as {
      profile_id: string; owner_id: string | null; leased_until: number | null;
      fencing_token: number; updated_at: number;
    } | undefined;
  return row === undefined ? null : Object.freeze({
    profileId: row.profile_id, ownerId: row.owner_id, leasedUntilMs: row.leased_until,
    fencingToken: row.fencing_token, updatedAtMs: row.updated_at,
  });
}

function event(
  lease: ExecutionLease,
  ownerId: string,
  kind: 'acquired' | 'renewed' | 'released' | 'lost',
  atMs: number,
  database: Db,
): void {
  const id = sha256Hex(`execution-lease:${lease.profileId}:${ownerId}:${lease.fencingToken}:${kind}:${atMs}`);
  database.prepare(`INSERT INTO execution_lease_events_v1
    (id, profile_id, owner_id, fencing_token, kind, at, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, '{}') ON CONFLICT(id) DO NOTHING`)
    .run(id, lease.profileId, ownerId, lease.fencingToken, kind, atMs);
}

export function acquireExecutionLease(
  profileId: string,
  ownerId: string,
  nowMs: number,
  leaseMs: number,
  database: Db,
): ExecutionLease | null {
  if (!PROFILE_ID.test(profileId) || !ownerId.trim() || !validTime(nowMs) ||
      !Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new TypeError('Invalid execution lease request.');
  if (!isAuthoritativeHost(profileId, ownerId, database)) return null;
  return inTransaction(database, () => {
    const current = read(profileId, database);
    if (current?.ownerId === ownerId && current.leasedUntilMs !== null && current.leasedUntilMs > nowMs) {
      return current;
    }
    if (current?.ownerId !== null && current?.ownerId !== undefined &&
        current.leasedUntilMs !== null && current.leasedUntilMs > nowMs) return null;
    if (current?.ownerId !== null && current?.ownerId !== undefined) {
      event(current, current.ownerId, 'lost', nowMs, database);
    }
    const nextToken = (current?.fencingToken ?? 0) + 1;
    database.prepare(`INSERT INTO execution_leases_v1
      (profile_id, owner_id, leased_until, fencing_token, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET owner_id = excluded.owner_id,
        leased_until = excluded.leased_until, fencing_token = excluded.fencing_token,
        updated_at = excluded.updated_at`)
      .run(profileId, ownerId, nowMs + leaseMs, nextToken, nowMs);
    const acquired = read(profileId, database)!;
    event(acquired, ownerId, 'acquired', nowMs, database);
    return acquired;
  });
}

export function renewExecutionLease(
  profileId: string,
  ownerId: string,
  fencingToken: number,
  nowMs: number,
  leaseMs: number,
  database: Db,
): boolean {
  if (!isAuthoritativeHost(profileId, ownerId, database)) return false;
  return inTransaction(database, () => {
    const prior = read(profileId, database);
    if (prior?.ownerId !== ownerId || prior.fencingToken !== fencingToken ||
        prior.leasedUntilMs === null || prior.leasedUntilMs <= nowMs) return false;
    const result = database.prepare(`UPDATE execution_leases_v1 SET leased_until = ?, updated_at = ?
      WHERE profile_id = ? AND owner_id = ? AND fencing_token = ? AND leased_until > ?`)
      .run(nowMs + leaseMs, nowMs, profileId, ownerId, fencingToken, nowMs);
    if (Number(result.changes) !== 1) return false;
    event(read(profileId, database)!, ownerId, 'renewed', nowMs, database);
    return true;
  });
}

export function validateExecutionLease(
  profileId: string,
  ownerId: string,
  fencingToken: number,
  nowMs: number,
  database: Db,
): boolean {
  const current = read(profileId, database);
  return isAuthoritativeHost(profileId, ownerId, database) && current?.ownerId === ownerId && current.fencingToken === fencingToken &&
    current.leasedUntilMs !== null && current.leasedUntilMs > nowMs;
}

export function releaseExecutionLease(
  profileId: string,
  ownerId: string,
  fencingToken: number,
  nowMs: number,
  database: Db,
): boolean {
  return inTransaction(database, () => {
    const prior = read(profileId, database);
    if (prior === null || prior.ownerId !== ownerId || prior.fencingToken !== fencingToken) return false;
    const result = database.prepare(`UPDATE execution_leases_v1
      SET owner_id = NULL, leased_until = NULL, updated_at = ?
      WHERE profile_id = ? AND owner_id = ? AND fencing_token = ?`)
      .run(nowMs, profileId, ownerId, fencingToken);
    if (Number(result.changes) !== 1) return false;
    event(prior, ownerId, 'released', nowMs, database);
    return true;
  });
}

export function getExecutionLease(profileId: string, database: Db): ExecutionLease | null {
  return read(profileId, database);
}
