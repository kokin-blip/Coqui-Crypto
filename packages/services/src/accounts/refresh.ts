import type { Clock } from '@coqui/core';
import type { ProfileManifestStore, StoredProfileRecord } from '@coqui/storage';

import {
  createProfileOperationGate,
  type AccountProfileResult,
  type ProfileOperationGate,
} from './profiles.js';

const REFRESH_CONCURRENCY = 4;
const MAX_EVIDENCE_COUNT = 10_000_000;

export type ProfileRefreshFailureCode =
  | 'credentials_unavailable'
  | 'credentials_invalid'
  | 'authentication_failed'
  | 'duplicate_connection'
  | 'clock_unavailable'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'elapsed_budget_exhausted'
  | 'data_invalid'
  | 'storage_unavailable'
  | 'storage_rejected'
  | 'unexpected_failure'
  | 'invalid_response';

export type ProfileRefreshExecutorResult =
  | { readonly status: 'refreshed'; readonly evidenceCount: number }
  | { readonly status: 'skipped'; readonly reasonCode: 'not_configured' }
  | { readonly status: 'failed'; readonly reasonCode: ProfileRefreshFailureCode }
  | { readonly status: 'cancelled'; readonly reasonCode: 'cancelled' | 'shutdown' };

export interface ProfileRefreshExecutorRequest {
  readonly profileId: string;
  readonly databaseFilename: string;
  readonly configurationHint: 'configured' | 'not_configured';
  readonly requestedAtMs: number;
  readonly signal?: AbortSignal;
}

/**
 * Authenticated provider acquisition remains behind this injected boundary. The
 * accounts service never receives credential values or provider diagnostics.
 */
export interface ProfileRefreshExecutor {
  refresh(request: ProfileRefreshExecutorRequest): Promise<ProfileRefreshExecutorResult>;
}

interface ProfileRefreshMetadata {
  readonly profileId: string;
  readonly profileName: string;
  readonly isActive: boolean;
}

export type ProfileRefreshOutcome =
  | (ProfileRefreshMetadata & {
    readonly status: 'refreshed';
    readonly evidenceCount: number;
  })
  | (ProfileRefreshMetadata & {
    readonly status: 'skipped';
    readonly reasonCode: 'not_configured';
  })
  | (ProfileRefreshMetadata & {
    readonly status: 'failed';
    readonly reasonCode: ProfileRefreshFailureCode;
  })
  | (ProfileRefreshMetadata & {
    readonly status: 'cancelled';
    readonly reasonCode: 'cancelled' | 'shutdown';
  });

export interface MultiProfileRefreshView {
  readonly requestedAtMs: number;
  readonly status: 'complete' | 'partial' | 'failed' | 'cancelled';
  readonly profileCount: number;
  readonly refreshedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly evidenceCount: number;
  readonly outcomes: readonly ProfileRefreshOutcome[];
}

export interface AccountsProfileRefreshDependencies {
  readonly clock: Clock;
  readonly manifestStore: ProfileManifestStore;
  readonly executor: ProfileRefreshExecutor;
  readonly operationGate?: ProfileOperationGate;
}

const FAILURE_CODES = new Set<ProfileRefreshFailureCode>([
  'credentials_unavailable', 'credentials_invalid', 'authentication_failed',
  'duplicate_connection', 'clock_unavailable', 'provider_unavailable', 'rate_limited',
  'elapsed_budget_exhausted', 'data_invalid', 'storage_unavailable', 'storage_rejected',
  'unexpected_failure', 'invalid_response',
]);

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function failure(
  code: 'profile_operation_in_progress' | 'profile_store_unavailable' |
    'profile_store_corrupt' | 'profile_refresh_invalid_metadata',
): AccountProfileResult<never> {
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

function metadata(record: StoredProfileRecord, activeProfileId: string): ProfileRefreshMetadata {
  return {
    profileId: record.id,
    profileName: record.name,
    isActive: record.id === activeProfileId,
  };
}

function normalized(
  value: unknown,
  record: StoredProfileRecord,
  activeProfileId: string,
): ProfileRefreshOutcome {
  const profile = metadata(record, activeProfileId);
  if (value === null || typeof value !== 'object') {
    return { ...profile, status: 'failed', reasonCode: 'invalid_response' };
  }
  const result = value as Partial<ProfileRefreshExecutorResult>;
  if (result.status === 'refreshed') {
    return typeof result.evidenceCount === 'number' && Number.isSafeInteger(result.evidenceCount) &&
      result.evidenceCount >= 0 && result.evidenceCount <= MAX_EVIDENCE_COUNT
      ? { ...profile, status: 'refreshed', evidenceCount: result.evidenceCount }
      : { ...profile, status: 'failed', reasonCode: 'invalid_response' };
  }
  if (result.status === 'skipped' && result.reasonCode === 'not_configured') {
    return { ...profile, status: 'skipped', reasonCode: 'not_configured' };
  }
  if (result.status === 'cancelled' &&
    (result.reasonCode === 'cancelled' || result.reasonCode === 'shutdown')) {
    return { ...profile, status: 'cancelled', reasonCode: result.reasonCode };
  }
  if (result.status === 'failed' && typeof result.reasonCode === 'string' &&
    FAILURE_CODES.has(result.reasonCode as ProfileRefreshFailureCode)) {
    return { ...profile, status: 'failed', reasonCode: result.reasonCode as ProfileRefreshFailureCode };
  }
  return { ...profile, status: 'failed', reasonCode: 'invalid_response' };
}

async function refreshProfiles(
  records: readonly StoredProfileRecord[],
  activeProfileId: string,
  requestedAtMs: number,
  executor: ProfileRefreshExecutor,
  signal?: AbortSignal,
): Promise<ProfileRefreshOutcome[]> {
  const outcomes = new Array<ProfileRefreshOutcome>(records.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, records.length) }, async () => {
    while (cursor < records.length) {
      const index = cursor;
      cursor += 1;
      const record = records[index]!;
      if (signal?.aborted) {
        outcomes[index] = { ...metadata(record, activeProfileId), status: 'cancelled', reasonCode: 'cancelled' };
        continue;
      }
      try {
        const result = await executor.refresh(Object.freeze({
          profileId: record.id,
          databaseFilename: record.dbFilename,
          configurationHint: record.coinbaseKeyFingerprint === undefined
            ? 'not_configured' : 'configured',
          requestedAtMs,
          ...(signal === undefined ? {} : { signal }),
        }));
        outcomes[index] = normalized(result, record, activeProfileId);
      } catch {
        outcomes[index] = {
          ...metadata(record, activeProfileId),
          status: signal?.aborted ? 'cancelled' : 'failed',
          reasonCode: signal?.aborted ? 'cancelled' : 'unexpected_failure',
        } as ProfileRefreshOutcome;
      }
    }
  }));
  return outcomes;
}

function aggregate(requestedAtMs: number, outcomes: readonly ProfileRefreshOutcome[]): MultiProfileRefreshView {
  const refreshedCount = outcomes.filter((item) => item.status === 'refreshed').length;
  const skippedCount = outcomes.filter((item) => item.status === 'skipped').length;
  const failedCount = outcomes.filter((item) => item.status === 'failed').length;
  const cancelledCount = outcomes.filter((item) => item.status === 'cancelled').length;
  const evidenceCount = outcomes.reduce(
    (total, item) => total + (item.status === 'refreshed' ? item.evidenceCount : 0),
    0,
  );
  const profileCount = outcomes.length;
  const status: MultiProfileRefreshView['status'] = profileCount > 0 && cancelledCount === profileCount
    ? 'cancelled'
    : profileCount > 0 && failedCount === profileCount ? 'failed'
      : failedCount > 0 || cancelledCount > 0 ? 'partial' : 'complete';
  return freeze({
    requestedAtMs,
    status,
    profileCount,
    refreshedCount,
    skippedCount,
    failedCount,
    cancelledCount,
    evidenceCount,
    outcomes: [...outcomes],
  });
}

/** Bounded explicit fan-out; it owns no credentials, provider client, scheduler, IPC, or UI. */
export class AccountsProfileRefreshService {
  readonly #clock: Clock;
  readonly #manifestStore: ProfileManifestStore;
  readonly #executor: ProfileRefreshExecutor;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: AccountsProfileRefreshDependencies) {
    this.#clock = dependencies.clock;
    this.#manifestStore = dependencies.manifestStore;
    this.#executor = dependencies.executor;
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  async refreshAll(signal?: AbortSignal): Promise<AccountProfileResult<MultiProfileRefreshView>> {
    if (!this.#operationGate.begin()) return failure('profile_operation_in_progress');
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
      const requestedAtMs = safeNow(this.#clock);
      if (requestedAtMs === null) return failure('profile_refresh_invalid_metadata');
      const records = [...loaded.value.manifest.profiles].sort((left, right) => left.order - right.order);
      const outcomes = await refreshProfiles(
        records,
        loaded.value.manifest.activeProfileId,
        requestedAtMs,
        this.#executor,
        signal,
      );
      return freeze({ ok: true, value: aggregate(requestedAtMs, outcomes) });
    } finally {
      this.#operationGate.end();
    }
  }
}
