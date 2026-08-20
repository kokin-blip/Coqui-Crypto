import {
  createCoinbaseReadHttpClient,
  fetchCoinbaseAccountEvidence,
  parseStoredCoinbaseCredentials,
  validateCoinbaseCredentials,
  type CoinbaseCredentials,
  type CoinbaseEvidenceAcquisitionResult,
  type SecretStore,
} from '@coqui/adapters';
import {
  coinbaseLocalBalancesFromLots,
  reconcileCoinbaseBalances,
  type Clock,
} from '@coqui/core';
import {
  inTransaction,
  listTaxLots,
  saveCoinbaseSyncEvidence,
  setSetting,
  type Db,
} from '@coqui/storage';

import type {
  ProfileRefreshExecutor,
  ProfileRefreshExecutorRequest,
  ProfileRefreshExecutorResult,
} from './refresh.js';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

export type CoinbaseSyncFailureCode =
  | 'invalid_profile_id'
  | 'invalid_request_time'
  | 'clock_unavailable'
  | 'credentials_unavailable'
  | 'credentials_invalid'
  | 'authentication_failed'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'elapsed_budget_exhausted'
  | 'data_invalid'
  | 'storage_rejected'
  | 'cancelled'
  | 'shutdown'
  | 'unexpected_failure';

export interface CoinbaseSyncView {
  readonly profileId: string;
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly datasetHash: string;
  readonly accountCount: number;
  readonly fillCount: number;
  readonly discrepancyCount: number;
  readonly evidenceCount: number;
  readonly created: boolean;
  readonly portfolioMutated: false;
  readonly syntheticLotsCreated: false;
  readonly syntheticFillsCreated: false;
}

export type CoinbaseSyncResult =
  | { readonly ok: true; readonly value: CoinbaseSyncView }
  | { readonly ok: false; readonly code: CoinbaseSyncFailureCode };

export interface CoinbaseEvidenceAcquirer {
  acquire(
    credentials: CoinbaseCredentials,
    signal?: AbortSignal,
  ): Promise<CoinbaseEvidenceAcquisitionResult>;
}

export interface CoinbaseAccountSyncDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly secretStore: SecretStore;
  readonly acquirer?: CoinbaseEvidenceAcquirer;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function safeNow(clock: Clock): number | null {
  try {
    const value = clock.nowMs();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function defaultAcquirer(): CoinbaseEvidenceAcquirer {
  return Object.freeze({
    async acquire(credentials: CoinbaseCredentials, signal?: AbortSignal) {
      const client = createCoinbaseReadHttpClient(credentials);
      try {
        return await fetchCoinbaseAccountEvidence(client, signal);
      } finally {
        client.destroy();
      }
    },
  });
}

function acquisitionFailure(
  result: Exclude<CoinbaseEvidenceAcquisitionResult, { ok: true }>,
): CoinbaseSyncFailureCode {
  if (result.code === 'cancelled') return 'cancelled';
  if (result.code === 'shutdown') return 'shutdown';
  if (result.code === 'elapsed_budget_exhausted') return 'elapsed_budget_exhausted';
  if (result.code === 'unauthorized' || result.code === 'forbidden') {
    return 'authentication_failed';
  }
  if (result.code === 'rate_limited') return 'rate_limited';
  if (result.code === 'network' || result.code === 'timeout' || result.code === 'http') {
    return 'provider_unavailable';
  }
  return 'data_invalid';
}

/** Acquire and append provider facts without modifying portfolio accounting. */
export class CoinbaseAccountSyncService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #secretStore: SecretStore;
  readonly #acquirer: CoinbaseEvidenceAcquirer;

  constructor(dependencies: CoinbaseAccountSyncDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#secretStore = dependencies.secretStore;
    this.#acquirer = dependencies.acquirer ?? defaultAcquirer();
  }

  async sync(
    profileId: string,
    requestedAtMs?: number,
    signal?: AbortSignal,
  ): Promise<CoinbaseSyncResult> {
    if (!PROFILE_ID.test(profileId)) {
      return freeze({ ok: false, code: 'invalid_profile_id' });
    }
    const requested = requestedAtMs ?? safeNow(this.#clock);
    if (requested === null || !Number.isSafeInteger(requested) || requested < 0) {
      return freeze({ ok: false, code: requestedAtMs === undefined
        ? 'clock_unavailable' : 'invalid_request_time' });
    }
    if (signal?.aborted) return freeze({ ok: false, code: 'cancelled' });
    let stored: Awaited<ReturnType<SecretStore['read']>>;
    try {
      stored = await this.#secretStore.read('coinbase-credentials', profileId);
    } catch {
      return freeze({ ok: false, code: 'credentials_unavailable' });
    }
    if (!stored.ok) return freeze({ ok: false, code: stored.code === 'unavailable'
      ? 'credentials_unavailable' : 'credentials_invalid' });
    if (stored.value === null) return freeze({ ok: false, code: 'credentials_unavailable' });
    const credentials = parseStoredCoinbaseCredentials(stored.value);
    if (credentials === null || !validateCoinbaseCredentials(credentials).ok) {
      return freeze({ ok: false, code: 'credentials_invalid' });
    }
    let acquired: CoinbaseEvidenceAcquisitionResult;
    try {
      acquired = await this.#acquirer.acquire(credentials, signal);
    } catch {
      return freeze({ ok: false, code: signal?.aborted
        ? 'cancelled' : 'unexpected_failure' });
    }
    if (!acquired.ok) return freeze({ ok: false, code: acquisitionFailure(acquired) });
    const receivedAtMs = safeNow(this.#clock);
    if (receivedAtMs === null || receivedAtMs < requested) {
      return freeze({ ok: false, code: 'clock_unavailable' });
    }
    try {
      const persisted = inTransaction(this.#database, () => {
        const localBalances = coinbaseLocalBalancesFromLots(listTaxLots(this.#database, true));
        const discrepancies = reconcileCoinbaseBalances(acquired.value.accounts, localBalances);
        const result = saveCoinbaseSyncEvidence({
          profileId,
          requestedAtMs: requested,
          receivedAtMs,
          accountPageCount: acquired.value.accountPageCount,
          fillPageCount: acquired.value.fillPageCount,
          datasetHash: acquired.value.datasetHash,
          accounts: acquired.value.accounts,
          fills: acquired.value.fills,
          discrepancies,
        }, this.#database);
        setSetting('coinbase.last_sync_at', String(receivedAtMs), this.#database);
        return { saved: result, discrepancyCount: discrepancies.length };
      });
      const evidenceCount = 1 + acquired.value.accounts.length +
        acquired.value.fills.length + persisted.discrepancyCount;
      return freeze({
        ok: true,
        value: {
          profileId,
          requestedAtMs: requested,
          receivedAtMs,
          datasetHash: acquired.value.datasetHash,
          accountCount: acquired.value.accounts.length,
          fillCount: acquired.value.fills.length,
          discrepancyCount: persisted.discrepancyCount,
          evidenceCount,
          created: persisted.saved.created,
          portfolioMutated: false,
          syntheticLotsCreated: false,
          syntheticFillsCreated: false,
        },
      });
    } catch {
      return freeze({ ok: false, code: 'storage_rejected' });
    }
  }
}

export interface CoinbaseProfileContext {
  readonly database: Db;
  close(): void;
}

export type CoinbaseProfileContextFactory = (
  request: Pick<ProfileRefreshExecutorRequest, 'profileId' | 'databaseFilename'>,
) => CoinbaseProfileContext;

export interface CoinbaseProfileRefreshExecutorDependencies {
  readonly clock: Clock;
  readonly secretStore: SecretStore;
  readonly openProfileContext: CoinbaseProfileContextFactory;
  readonly acquirer?: CoinbaseEvidenceAcquirer;
}

function refreshResult(result: CoinbaseSyncResult): ProfileRefreshExecutorResult {
  if (result.ok) return { status: 'refreshed', evidenceCount: result.value.evidenceCount };
  if (result.code === 'cancelled' || result.code === 'shutdown') {
    return { status: 'cancelled', reasonCode: result.code };
  }
  const mapping: Record<Exclude<CoinbaseSyncFailureCode, 'cancelled' | 'shutdown'>,
    Exclude<ProfileRefreshExecutorResult, { status: 'refreshed' | 'skipped' | 'cancelled' }>['reasonCode']> = {
      invalid_profile_id: 'invalid_response',
      invalid_request_time: 'invalid_response',
      clock_unavailable: 'clock_unavailable',
      credentials_unavailable: 'credentials_unavailable',
      credentials_invalid: 'credentials_invalid',
      authentication_failed: 'authentication_failed',
      provider_unavailable: 'provider_unavailable',
      rate_limited: 'rate_limited',
      elapsed_budget_exhausted: 'elapsed_budget_exhausted',
      data_invalid: 'data_invalid',
      storage_rejected: 'storage_rejected',
      unexpected_failure: 'unexpected_failure',
    };
  return { status: 'failed', reasonCode: mapping[result.code] };
}

/** Bind profile refresh to the account-evidence sync behind an injected context boundary. */
export function createCoinbaseProfileRefreshExecutor(
  dependencies: CoinbaseProfileRefreshExecutorDependencies,
): ProfileRefreshExecutor {
  const openContext = dependencies.openProfileContext;
  return Object.freeze({
    async refresh(request: ProfileRefreshExecutorRequest): Promise<ProfileRefreshExecutorResult> {
      if (request.configurationHint === 'not_configured') {
        return { status: 'skipped', reasonCode: 'not_configured' };
      }
      let context: CoinbaseProfileContext;
      try {
        context = openContext(request);
      } catch {
        return { status: 'failed', reasonCode: 'storage_unavailable' };
      }
      try {
        return refreshResult(await new CoinbaseAccountSyncService({
          database: context.database,
          clock: dependencies.clock,
          secretStore: dependencies.secretStore,
          ...(dependencies.acquirer === undefined ? {} : { acquirer: dependencies.acquirer }),
        }).sync(request.profileId, request.requestedAtMs, request.signal));
      } finally {
        context.close();
      }
    },
  });
}
