import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  getWalletRiskState,
  getWalletSchedule,
  type StoredWalletRiskState,
  type StoredWalletScheduleLease,
} from '../repositories/wallet-scheduler.js';
import {
  getWalletSafetyStop,
  type RuntimeIncident,
  type StoredWalletSafetyStop,
} from '../repositories/wallet-audit.js';

export interface StoredRuntimeIncidentCount {
  readonly kind: RuntimeIncident['kind'];
  readonly severity: RuntimeIncident['severity'];
  readonly count: number;
}

export interface StoredProfileDashboardFacts {
  readonly schemaVersion: number;
  readonly lastCoinbaseSyncAtMs: number | null;
  readonly schedule: StoredWalletScheduleLease | null;
  readonly riskState: StoredWalletRiskState | null;
  readonly safetyStop: StoredWalletSafetyStop | null;
  readonly unresolvedIncidents: readonly StoredRuntimeIncidentCount[];
}

export type ProfileDashboardFactsResult =
  | { readonly ok: true; readonly facts: StoredProfileDashboardFacts }
  | { readonly ok: false; readonly code: 'unavailable' | 'corrupt' };

export interface ProfileDashboardFactsReader {
  read(profileId: string, dbFilename: string): Promise<ProfileDashboardFactsResult>;
}

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const INCIDENT_KINDS = new Set<RuntimeIncident['kind']>([
  'stale_data', 'sequence_gap', 'reconciliation', 'scheduler_failure',
  'risk_stop', 'execution_fault', 'provider_invalid', 'worker_failure',
]);
const INCIDENT_SEVERITIES = new Set<RuntimeIncident['severity']>([
  'warning', 'blocking', 'critical',
]);
const STABLE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;

function inside(root: string, target: string): boolean {
  const child = relative(root, target);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}

function safeFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !value.includes('\0') && !value.includes('/') && !value.includes('\\') && value.endsWith('.db');
}

function safeInteger(value: unknown): number | null {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isSafeInteger(converted) && converted >= 0 ? converted : null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function validSchedule(profileId: string, schedule: StoredWalletScheduleLease | null): boolean {
  return schedule === null || schedule.profileId === profileId &&
    Number.isSafeInteger(schedule.cadenceMs) && schedule.cadenceMs > 0 &&
    Number.isSafeInteger(schedule.utcOffsetMs) && schedule.utcOffsetMs >= 0 &&
    schedule.utcOffsetMs < schedule.cadenceMs && safeInteger(schedule.nextRunAt) !== null &&
    (schedule.lastRunAt === null || safeInteger(schedule.lastRunAt) !== null) &&
    (schedule.leasedUntil === null || safeInteger(schedule.leasedUntil) !== null) &&
    ['idle', 'running', 'stopped', 'error'].includes(schedule.state);
}

function validRisk(profileId: string, risk: StoredWalletRiskState | null): boolean {
  return risk === null || risk.profileId === profileId && STABLE_CODE.test(risk.stage) &&
    safeInteger(risk.updatedAt) !== null;
}

function validSafety(profileId: string, stop: StoredWalletSafetyStop | null): boolean {
  return stop === null || stop.profileId === profileId && stop.kind.trim().length > 0 &&
    safeInteger(stop.triggeredAt) !== null && safeInteger(stop.updatedAt) !== null &&
    (stop.acknowledgedAt === null || safeInteger(stop.acknowledgedAt) !== null);
}

/** Read sanitized operational dashboard facts without secret or diagnostic payload access. */
export function createFileProfileDashboardFactsReader(
  profilesDirectory: string,
): ProfileDashboardFactsReader {
  if (!profilesDirectory) throw new TypeError('A profile database root is required.');
  return Object.freeze({
    async read(profileId: string, dbFilename: string): Promise<ProfileDashboardFactsResult> {
      if (!PROFILE_ID.test(profileId) || !safeFilename(dbFilename)) {
        return { ok: false, code: 'unavailable' };
      }
      let database: DatabaseSync | null = null;
      try {
        const root = realpathSync(profilesDirectory);
        const candidate = resolve(root, dbFilename);
        if (!inside(root, candidate) || !existsSync(candidate) || !statSync(candidate).isFile()) {
          return { ok: false, code: 'unavailable' };
        }
        const path = realpathSync(candidate);
        if (!inside(root, path)) return { ok: false, code: 'unavailable' };
        database = new DatabaseSync(path, { readOnly: true, allowExtension: false });
        const versionRow = database.prepare('PRAGMA user_version').get() as Record<string, unknown>;
        const schemaVersion = safeInteger(versionRow['user_version']);
        if (schemaVersion === null) return { ok: false, code: 'corrupt' };
        const syncRow = database.prepare(
          "SELECT value FROM app_settings WHERE key = 'coinbase.last_sync_at'",
        ).get() as Record<string, unknown> | undefined;
        let lastCoinbaseSyncAtMs: number | null = null;
        if (syncRow !== undefined) {
          if (typeof syncRow['value'] !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(syncRow['value'])) {
            return { ok: false, code: 'corrupt' };
          }
          const parsed = Number(syncRow['value']);
          if (!Number.isSafeInteger(parsed) || parsed < 0) return { ok: false, code: 'corrupt' };
          lastCoinbaseSyncAtMs = parsed === 0 ? null : parsed;
        }
        const incidentRows = database.prepare(`
          SELECT kind, severity, COUNT(*) AS count
          FROM runtime_incidents
          WHERE profile_id = ? AND resolved_at IS NULL
          GROUP BY kind, severity
          ORDER BY severity, kind
        `).all(profileId) as Array<Record<string, unknown>>;
        const unresolvedIncidents: StoredRuntimeIncidentCount[] = [];
        for (const row of incidentRows) {
          const kind = row['kind'];
          const severity = row['severity'];
          const count = safeInteger(row['count']);
          if (typeof kind !== 'string' || !INCIDENT_KINDS.has(kind as RuntimeIncident['kind']) ||
            typeof severity !== 'string' ||
            !INCIDENT_SEVERITIES.has(severity as RuntimeIncident['severity']) || count === null) {
            return { ok: false, code: 'corrupt' };
          }
          unresolvedIncidents.push({
            kind: kind as RuntimeIncident['kind'],
            severity: severity as RuntimeIncident['severity'],
            count,
          });
        }
        const schedule = getWalletSchedule(profileId, database);
        const riskState = getWalletRiskState(profileId, database);
        const safetyStop = getWalletSafetyStop(profileId, database);
        if (!validSchedule(profileId, schedule) || !validRisk(profileId, riskState) ||
          !validSafety(profileId, safetyStop)) return { ok: false, code: 'corrupt' };
        return freeze({
          ok: true,
          facts: {
            schemaVersion,
            lastCoinbaseSyncAtMs,
            schedule,
            riskState,
            safetyStop,
            unresolvedIncidents,
          },
        });
      } catch {
        return { ok: false, code: 'corrupt' };
      } finally {
        database?.close();
      }
    },
  });
}
