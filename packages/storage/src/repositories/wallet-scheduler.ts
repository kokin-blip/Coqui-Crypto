import { nonNegativeDecimal } from '@coqui/core';

import { inTransaction, type Db } from '../sqlite/index.js';

export interface StoredWalletScheduleLease {
  readonly profileId: string;
  readonly ownerId: string | null;
  readonly leasedUntil: number | null;
  readonly nextRunAt: number;
  readonly lastRunAt: number | null;
  readonly state: 'idle' | 'running' | 'stopped' | 'error';
  readonly error: string | null;
}

interface WalletScheduleRow {
  profile_id: string;
  owner_id: string | null;
  leased_until: number | null;
  next_run_at: number;
  last_run_at: number | null;
  state: StoredWalletScheduleLease['state'];
  error: string | null;
}

function scheduleFromRow(row: WalletScheduleRow): StoredWalletScheduleLease {
  return {
    profileId: row.profile_id,
    ownerId: row.owner_id,
    leasedUntil: row.leased_until,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    state: row.state,
    error: row.error,
  };
}

export function ensureWalletSchedule(
  profileId: string,
  nextRunAt: number,
  database: Db,
): StoredWalletScheduleLease {
  database.prepare(`
    INSERT INTO wallet_schedule_lease
      (profile_id, owner_id, leased_until, next_run_at, last_run_at, state, error)
    VALUES (?, NULL, NULL, ?, NULL, 'idle', NULL)
    ON CONFLICT(profile_id) DO NOTHING
  `).run(profileId, nextRunAt);
  return getWalletSchedule(profileId, database)!;
}

export function getWalletSchedule(
  profileId: string,
  database: Db,
): StoredWalletScheduleLease | null {
  const row = database.prepare(
    'SELECT * FROM wallet_schedule_lease WHERE profile_id = ?',
  ).get(profileId) as WalletScheduleRow | undefined;
  return row ? scheduleFromRow(row) : null;
}

export function acquireWalletScheduleLease(
  profileId: string,
  ownerId: string,
  now: number,
  leaseMs: number,
  database: Db,
): StoredWalletScheduleLease | null {
  if (!ownerId.trim() || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new TypeError('A lease requires an owner and positive duration.');
  }
  return inTransaction(database, () => {
    const current = getWalletSchedule(profileId, database);
    if (!current || current.nextRunAt > now) return null;
    if (
      current.ownerId &&
      current.ownerId !== ownerId &&
      current.leasedUntil !== null &&
      current.leasedUntil > now
    ) return null;
    database.prepare(`
      UPDATE wallet_schedule_lease
      SET owner_id = ?, leased_until = ?, state = 'running', error = NULL
      WHERE profile_id = ?
    `).run(ownerId, now + leaseMs, profileId);
    return getWalletSchedule(profileId, database);
  });
}

export function releaseWalletScheduleLease(
  profileId: string,
  ownerId: string,
  nextRunAt: number,
  state: StoredWalletScheduleLease['state'],
  error: string | null,
  now: number,
  database: Db,
): boolean {
  const result = database.prepare(`
    UPDATE wallet_schedule_lease
    SET owner_id = NULL, leased_until = NULL, next_run_at = ?, last_run_at = ?,
        state = ?, error = ?
    WHERE profile_id = ? AND owner_id = ?
  `).run(nextRunAt, now, state, error, profileId, ownerId);
  return Number(result.changes) === 1;
}

export interface StoredWalletRiskState {
  readonly profileId: string;
  readonly stage: string;
  readonly dailyPeakUsd: string | null;
  readonly rollingPeakUsd: string | null;
  readonly lifetimePeakUsd: string | null;
  readonly hardStopped: boolean;
  readonly reason: string | null;
  readonly updatedAt: number;
}

export function saveWalletRiskState(state: StoredWalletRiskState, database: Db): void {
  for (const value of [state.dailyPeakUsd, state.rollingPeakUsd, state.lifetimePeakUsd]) {
    if (value !== null) nonNegativeDecimal(value);
  }
  database.prepare(`
    INSERT INTO wallet_risk_state_v2 (
      profile_id, stage, daily_peak_usd_text, rolling_peak_usd_text, lifetime_peak_usd_text,
      hard_stopped, reason, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      stage = excluded.stage,
      daily_peak_usd_text = excluded.daily_peak_usd_text,
      rolling_peak_usd_text = excluded.rolling_peak_usd_text,
      lifetime_peak_usd_text = excluded.lifetime_peak_usd_text,
      hard_stopped = excluded.hard_stopped,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `).run(
    state.profileId,
    state.stage,
    state.dailyPeakUsd,
    state.rollingPeakUsd,
    state.lifetimePeakUsd,
    state.hardStopped ? 1 : 0,
    state.reason,
    state.updatedAt,
  );
}

export function getWalletRiskState(
  profileId: string,
  database: Db,
): StoredWalletRiskState | null {
  const row = database.prepare(
    'SELECT * FROM wallet_risk_state_v2 WHERE profile_id = ?',
  ).get(profileId) as {
    profile_id: string;
    stage: string;
    daily_peak_usd_text: string | null;
    rolling_peak_usd_text: string | null;
    lifetime_peak_usd_text: string | null;
    hard_stopped: number;
    reason: string | null;
    updated_at: number;
  } | undefined;
  return row ? {
    profileId: row.profile_id,
    stage: row.stage,
    dailyPeakUsd: row.daily_peak_usd_text === null ? null : nonNegativeDecimal(row.daily_peak_usd_text),
    rollingPeakUsd: row.rolling_peak_usd_text === null ? null : nonNegativeDecimal(row.rolling_peak_usd_text),
    lifetimePeakUsd: row.lifetime_peak_usd_text === null ? null : nonNegativeDecimal(row.lifetime_peak_usd_text),
    hardStopped: row.hard_stopped === 1,
    reason: row.reason,
    updatedAt: row.updated_at,
  } : null;
}

export interface StoredWalletRiskProfile {
  readonly profileId: string;
  readonly version: string;
  readonly profileJson: string;
  readonly updatedAt: number;
}

export function saveWalletRiskProfile(profile: StoredWalletRiskProfile, database: Db): void {
  JSON.parse(profile.profileJson);
  database.prepare(`
    INSERT INTO wallet_risk_profiles (profile_id, version, profile_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      version = excluded.version,
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `).run(profile.profileId, profile.version, profile.profileJson, profile.updatedAt);
}

export function getWalletRiskProfile(
  profileId: string,
  database: Db,
): StoredWalletRiskProfile | null {
  const row = database.prepare(
    'SELECT * FROM wallet_risk_profiles WHERE profile_id = ?',
  ).get(profileId) as {
    profile_id: string;
    version: string;
    profile_json: string;
    updated_at: number;
  } | undefined;
  return row ? {
    profileId: row.profile_id,
    version: row.version,
    profileJson: row.profile_json,
    updatedAt: row.updated_at,
  } : null;
}

export interface StoredWalletDecisionRun {
  readonly id: string;
  readonly profileId: string;
  readonly scheduledFor: number;
  readonly strategyVersion: string;
  readonly snapshotHash: string;
  readonly snapshotJson: string;
  readonly status: 'prepared' | 'applied' | 'completed' | 'failed';
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly error: string | null;
}

export function saveWalletDecisionRun(run: StoredWalletDecisionRun, database: Db): void {
  JSON.parse(run.snapshotJson);
  const existing = getWalletDecisionRun(run.id, database);
  if (existing && (
    existing.profileId !== run.profileId ||
    existing.scheduledFor !== run.scheduledFor ||
    existing.strategyVersion !== run.strategyVersion ||
    existing.snapshotHash !== run.snapshotHash ||
    existing.snapshotJson !== run.snapshotJson ||
    existing.createdAt !== run.createdAt
  )) throw new Error('Wallet decision snapshots are immutable.');
  database.prepare(`
    INSERT INTO wallet_decision_runs (
      id, profile_id, scheduled_for, strategy_version, snapshot_hash,
      snapshot_json, status, created_at, updated_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at,
      error = excluded.error
  `).run(
    run.id,
    run.profileId,
    run.scheduledFor,
    run.strategyVersion,
    run.snapshotHash,
    run.snapshotJson,
    run.status,
    run.createdAt,
    run.updatedAt,
    run.error,
  );
}

export function getWalletDecisionRun(
  id: string,
  database: Db,
): StoredWalletDecisionRun | null {
  const row = database.prepare('SELECT * FROM wallet_decision_runs WHERE id = ?').get(id) as {
    id: string;
    profile_id: string;
    scheduled_for: number;
    strategy_version: string;
    snapshot_hash: string;
    snapshot_json: string;
    status: StoredWalletDecisionRun['status'];
    created_at: number;
    updated_at: number;
    error: string | null;
  } | undefined;
  return row ? {
    id: row.id,
    profileId: row.profile_id,
    scheduledFor: row.scheduled_for,
    strategyVersion: row.strategy_version,
    snapshotHash: row.snapshot_hash,
    snapshotJson: row.snapshot_json,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error,
  } : null;
}

export function countCompletedDecisionRuns(
  profileId: string,
  sinceMs: number,
  database: Db,
): number {
  const row = database.prepare(`
    SELECT COUNT(*) AS count FROM wallet_decision_runs
    WHERE profile_id = ? AND scheduled_for >= ? AND status = 'completed'
  `).get(profileId, sinceMs) as { count: number };
  return row.count;
}
