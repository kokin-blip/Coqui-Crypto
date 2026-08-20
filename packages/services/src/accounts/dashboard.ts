import { sumUsdAmounts, type Clock, type UsdAmount } from '@coqui/core';
import {
  type ProfileDashboardFactsReader,
  type ProfileManifestStore,
  type StoredProfileDashboardFacts,
  type StoredProfileRecord,
  type StoredWalletScheduleLease,
} from '@coqui/storage';

import type {
  ProfileComparisonEntry,
  ProfileComparisonPricing,
  ProfileComparisonView,
  ProfilePaperComparison,
  ProfileTrackedComparison,
} from './comparison.js';
import {
  createProfileOperationGate,
  type AccountProfileResult,
  type ProfileOperationGate,
} from './profiles.js';

const STATUS_READ_CONCURRENCY = 4;
const FRESHNESS_MS = 15 * 60_000;
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/u;

export interface ProfileComparisonSource {
  compare(): Promise<AccountProfileResult<ProfileComparisonView>>;
}

export type DashboardWarningCode =
  | 'profile_data_unavailable'
  | 'operational_status_unavailable'
  | 'tracked_valuation_incomplete'
  | 'paper_valuation_incomplete'
  | 'pricing_failed'
  | 'coinbase_never_synced'
  | 'coinbase_data_stale'
  | 'coinbase_sync_time_invalid'
  | 'schedule_overdue'
  | 'schedule_error'
  | 'schedule_lease_expired'
  | 'hard_stop_active'
  | 'safety_stop_active'
  | 'unresolved_incidents';

export type DashboardFreshness =
  | { readonly state: 'not_configured' | 'never'; readonly asOfMs: null; readonly ageMs: null }
  | { readonly state: 'fresh' | 'stale'; readonly asOfMs: number; readonly ageMs: number }
  | { readonly state: 'invalid'; readonly asOfMs: number; readonly ageMs: null };

export type DashboardAutomationHealth =
  | 'not_configured'
  | 'disabled'
  | 'scheduled'
  | 'running'
  | 'overdue'
  | 'lease_expired'
  | 'stopped'
  | 'error';

export interface DashboardAutomationView {
  readonly health: DashboardAutomationHealth;
  readonly cadenceMs: number | null;
  readonly utcOffsetMs: number | null;
  readonly nextRunAtMs: number | null;
  readonly lastRunAtMs: number | null;
  readonly leaseActive: boolean;
  readonly leaseExpiresAtMs: number | null;
  readonly reasonCode: string | null;
}

export interface DashboardRiskView {
  readonly stageCode: string;
  readonly hardStopped: boolean;
  readonly updatedAtMs: number;
}

export interface DashboardSafetyStopView {
  readonly active: boolean;
  readonly kindCode: string;
  readonly triggeredAtMs: number;
  readonly acknowledgedAtMs: number | null;
}

export interface ProfileDashboardEntry {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly icon: string;
  readonly isActive: boolean;
  readonly dataStatus: 'available' | 'partial' | 'unavailable';
  readonly tracked: ProfileTrackedComparison | null;
  readonly paper: ProfilePaperComparison | null;
  readonly pricing: ProfileComparisonPricing | null;
  readonly coinbaseConfigurationHint: 'configured' | 'not_configured';
  readonly freshness: DashboardFreshness;
  readonly automation: DashboardAutomationView | null;
  readonly risk: DashboardRiskView | null;
  readonly safetyStop: DashboardSafetyStopView | null;
  readonly unresolvedIncidentCount: number | null;
  readonly warningCodes: readonly DashboardWarningCode[];
}

export interface MultiProfileDashboardView {
  readonly asOfMs: number;
  readonly valuationRequestedAtMs: number;
  readonly valuationReceivedAtMs: number;
  readonly requestedSource: string;
  readonly status: 'complete' | 'partial';
  readonly profileCount: number;
  readonly trackedPricedSubtotalUsd: UsdAmount;
  readonly trackedCompleteTotalUsd: UsdAmount | null;
  readonly paperPricedSubtotalUsd: UsdAmount;
  readonly paperCompleteTotalUsd: UsdAmount | null;
  readonly profiles: readonly ProfileDashboardEntry[];
}

export interface AccountsProfileDashboardDependencies {
  readonly clock: Clock;
  readonly manifestStore: ProfileManifestStore;
  readonly comparisonSource: ProfileComparisonSource;
  readonly factsReader: ProfileDashboardFactsReader;
  readonly operationGate?: ProfileOperationGate;
}

interface StatusRead {
  readonly record: StoredProfileRecord;
  readonly facts: StoredProfileDashboardFacts | null;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function failure(code: 'profile_operation_in_progress' | 'profile_store_unavailable' |
  'profile_store_corrupt' | 'profile_dashboard_invalid_metadata' |
  'profile_dashboard_snapshot_conflict'): AccountProfileResult<never> {
  return freeze({ ok: false, issues: [{ path: [], code }] });
}

function safeNow(clock: Clock): number | null {
  try {
    const value = clock.nowMs();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function safeTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validSchedule(value: StoredWalletScheduleLease | null): value is StoredWalletScheduleLease {
  return value !== null && safeTime(value.nextRunAt) &&
    (value.lastRunAt === null || safeTime(value.lastRunAt)) &&
    (value.leasedUntil === null || safeTime(value.leasedUntil)) &&
    Number.isSafeInteger(value.cadenceMs) && value.cadenceMs > 0 &&
    Number.isSafeInteger(value.utcOffsetMs) && value.utcOffsetMs >= 0 &&
    value.utcOffsetMs < value.cadenceMs &&
    ['idle', 'running', 'stopped', 'error'].includes(value.state);
}

function automation(
  schedule: StoredWalletScheduleLease | null,
  now: number,
): DashboardAutomationView {
  if (!validSchedule(schedule)) return {
    health: 'not_configured', cadenceMs: null, utcOffsetMs: null,
    nextRunAtMs: null, lastRunAtMs: null, leaseActive: false,
    leaseExpiresAtMs: null, reasonCode: null,
  };
  const leaseActive = schedule.ownerId !== null && schedule.leasedUntil !== null &&
    schedule.leasedUntil > now;
  const health: DashboardAutomationHealth = !schedule.enabled
    ? 'disabled'
    : leaseActive ? 'running'
      : schedule.state === 'running' ? 'lease_expired'
        : schedule.state === 'error' ? 'error'
          : schedule.state === 'stopped' ? 'stopped'
            : schedule.nextRunAt <= now ? 'overdue' : 'scheduled';
  return {
    health,
    cadenceMs: schedule.cadenceMs,
    utcOffsetMs: schedule.utcOffsetMs,
    nextRunAtMs: schedule.nextRunAt,
    lastRunAtMs: schedule.lastRunAt,
    leaseActive,
    leaseExpiresAtMs: schedule.leasedUntil,
    reasonCode: health === 'lease_expired' ? 'lease_expired'
      : REASON_CODE.test(schedule.error ?? '') ? schedule.error : null,
  };
}

function freshness(configured: boolean, lastSync: number | null, now: number): DashboardFreshness {
  if (!configured) return { state: 'not_configured', asOfMs: null, ageMs: null };
  if (lastSync === null) return { state: 'never', asOfMs: null, ageMs: null };
  if (lastSync > now) return { state: 'invalid', asOfMs: lastSync, ageMs: null };
  const ageMs = now - lastSync;
  return { state: ageMs <= FRESHNESS_MS ? 'fresh' : 'stale', asOfMs: lastSync, ageMs };
}

async function readStatuses(
  records: readonly StoredProfileRecord[],
  reader: ProfileDashboardFactsReader,
): Promise<StatusRead[]> {
  const results = new Array<StatusRead>(records.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(STATUS_READ_CONCURRENCY, records.length) }, async () => {
    while (cursor < records.length) {
      const index = cursor;
      cursor += 1;
      const record = records[index]!;
      try {
        const read = await reader.read(record.id, record.dbFilename);
        results[index] = { record, facts: read.ok ? read.facts : null };
      } catch {
        results[index] = { record, facts: null };
      }
    }
  }));
  return results;
}

function incidentCount(facts: StoredProfileDashboardFacts): number | null {
  const total = facts.unresolvedIncidents.reduce((sum, incident) => sum + incident.count, 0);
  return Number.isSafeInteger(total) ? total : null;
}

function risk(facts: StoredProfileDashboardFacts): DashboardRiskView | null {
  const state = facts.riskState;
  if (!state || !safeTime(state.updatedAt) || !REASON_CODE.test(state.stage)) return null;
  return { stageCode: state.stage, hardStopped: state.hardStopped, updatedAtMs: state.updatedAt };
}

function safety(facts: StoredProfileDashboardFacts): DashboardSafetyStopView | null {
  const stop = facts.safetyStop;
  if (!stop || !safeTime(stop.triggeredAt) ||
    (stop.acknowledgedAt !== null && !safeTime(stop.acknowledgedAt))) return null;
  return {
    active: stop.active,
    kindCode: REASON_CODE.test(stop.kind) ? stop.kind : 'unknown',
    triggeredAtMs: stop.triggeredAt,
    acknowledgedAtMs: stop.acknowledgedAt,
  };
}

function warnings(
  comparison: ProfileComparisonEntry,
  facts: StoredProfileDashboardFacts | null,
  fresh: DashboardFreshness,
  schedule: DashboardAutomationView | null,
  riskView: DashboardRiskView | null,
  safetyStop: DashboardSafetyStopView | null,
  incidents: number | null,
): DashboardWarningCode[] {
  const result: DashboardWarningCode[] = [];
  if (comparison.status === 'unavailable') result.push('profile_data_unavailable');
  if (facts === null) result.push('operational_status_unavailable');
  if (comparison.tracked?.completeValueUsd === null) result.push('tracked_valuation_incomplete');
  if (comparison.paper?.completeValueUsd === null) result.push('paper_valuation_incomplete');
  if (comparison.pricing?.status === 'failed') result.push('pricing_failed');
  if (fresh.state === 'never') result.push('coinbase_never_synced');
  if (fresh.state === 'stale') result.push('coinbase_data_stale');
  if (fresh.state === 'invalid') result.push('coinbase_sync_time_invalid');
  if (schedule?.health === 'overdue') result.push('schedule_overdue');
  if (schedule?.health === 'error') result.push('schedule_error');
  if (schedule?.health === 'lease_expired') result.push('schedule_lease_expired');
  if (riskView?.hardStopped) result.push('hard_stop_active');
  if (safetyStop?.active) result.push('safety_stop_active');
  if (incidents !== null && incidents > 0) result.push('unresolved_incidents');
  return result;
}

/** Compose valuation and operational evidence without gaining credential or execution authority. */
export class AccountsProfileDashboardService {
  readonly #clock: Clock;
  readonly #manifestStore: ProfileManifestStore;
  readonly #comparisonSource: ProfileComparisonSource;
  readonly #factsReader: ProfileDashboardFactsReader;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: AccountsProfileDashboardDependencies) {
    this.#clock = dependencies.clock;
    this.#manifestStore = dependencies.manifestStore;
    this.#comparisonSource = dependencies.comparisonSource;
    this.#factsReader = dependencies.factsReader;
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  async dashboard(): Promise<AccountProfileResult<MultiProfileDashboardView>> {
    const compared = await this.#comparisonSource.compare();
    if (!compared.ok) return compared;
    if (!this.#operationGate.begin()) return failure('profile_operation_in_progress');
    let statuses: StatusRead[];
    try {
      let loaded: ReturnType<ProfileManifestStore['read']>;
      try {
        loaded = this.#manifestStore.read();
      } catch {
        return failure('profile_store_unavailable');
      }
      if (!loaded.ok) return failure(loaded.code === 'corrupt'
        ? 'profile_store_corrupt' : 'profile_store_unavailable');
      if (!loaded.value) return failure('profile_store_unavailable');
      const records = [...loaded.value.manifest.profiles].sort((left, right) => left.order - right.order);
      if (records.length !== compared.value.profiles.length || records.some(
        (record, index) => record.id !== compared.value.profiles[index]?.id,
      )) return failure('profile_dashboard_snapshot_conflict');
      statuses = await readStatuses(records, this.#factsReader);
    } finally {
      this.#operationGate.end();
    }
    const now = safeNow(this.#clock);
    if (now === null) return failure('profile_dashboard_invalid_metadata');

    const entries = compared.value.profiles.map((comparison, index): ProfileDashboardEntry => {
      const status = statuses[index]!;
      const facts = status.facts;
      const configured = status.record.coinbaseKeyFingerprint !== undefined;
      const fresh = freshness(configured, facts?.lastCoinbaseSyncAtMs ?? null, now);
      const automationView = facts ? automation(facts.schedule, now) : null;
      const riskView = facts ? risk(facts) : null;
      const safetyStop = facts ? safety(facts) : null;
      const incidents = facts ? incidentCount(facts) : null;
      const warningCodes = warnings(
        comparison, facts, fresh, automationView, riskView, safetyStop, incidents,
      );
      const dataStatus: ProfileDashboardEntry['dataStatus'] = comparison.status === 'unavailable'
        ? 'unavailable'
        : facts === null || warningCodes.length > 0 ? 'partial' : 'available';
      return freeze({
        id: comparison.id,
        name: comparison.name,
        color: comparison.color,
        icon: comparison.icon,
        isActive: comparison.isActive,
        dataStatus,
        tracked: comparison.tracked,
        paper: comparison.paper,
        pricing: comparison.pricing,
        coinbaseConfigurationHint: configured ? 'configured' : 'not_configured',
        freshness: fresh,
        automation: automationView,
        risk: riskView,
        safetyStop,
        unresolvedIncidentCount: incidents,
        warningCodes,
      });
    });
    const available = entries.filter((entry) => entry.tracked !== null && entry.paper !== null);
    const trackedPricedSubtotalUsd = sumUsdAmounts(
      available.map((entry) => entry.tracked!.pricedSubtotalUsd),
    );
    const paperPricedSubtotalUsd = sumUsdAmounts(available.map((entry) =>
      sumUsdAmounts([entry.paper!.cashUsd, entry.paper!.pricedAssetValueUsd])));
    const allComplete = available.length === entries.length;
    const trackedComplete = allComplete && entries.every((entry) => entry.tracked?.completeValueUsd !== null);
    const paperComplete = allComplete && entries.every((entry) => entry.paper?.completeValueUsd !== null);
    const trackedCompleteTotalUsd = trackedComplete
      ? sumUsdAmounts(entries.map((entry) => entry.tracked!.completeValueUsd!)) : null;
    const paperCompleteTotalUsd = paperComplete
      ? sumUsdAmounts(entries.map((entry) => entry.paper!.completeValueUsd!)) : null;
    return freeze({
      ok: true,
      value: {
        asOfMs: now,
        valuationRequestedAtMs: compared.value.requestedAtMs,
        valuationReceivedAtMs: compared.value.receivedAtMs,
        requestedSource: compared.value.requestedSource,
        status: entries.every((entry) => entry.dataStatus === 'available') ? 'complete' : 'partial',
        profileCount: entries.length,
        trackedPricedSubtotalUsd,
        trackedCompleteTotalUsd,
        paperPricedSubtotalUsd,
        paperCompleteTotalUsd,
        profiles: entries,
      },
    });
  }
}
