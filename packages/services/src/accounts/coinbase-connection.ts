import {
  createCoinbaseReadHttpClient,
  parseCoinbaseKeyFileJson,
  parseStoredCoinbaseCredentials,
  probeCoinbaseViewOnlyPermissions,
  serializeCoinbaseCredentials,
  validateCoinbaseCredentials,
  type CoinbaseCredentials,
  type CoinbaseProbeErrorCode,
  type CoinbaseReadHttpClient,
  type SecretStore,
  type SecretStoreErrorCode,
} from '@coqui/adapters';
import { sha256Hex, type Clock } from '@coqui/core';
import {
  type ProfileManifestSnapshot,
  type ProfileManifestStore,
  type StoredProfileRecord,
} from '@coqui/storage';

import {
  createProfileOperationGate,
  type ProfileOperationGate,
} from './profiles.js';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type CoinbaseConnectionState =
  | 'connected'
  | 'disconnected'
  | 'attention_required'
  | 'unavailable';

export type CoinbaseConnectionReasonCode =
  | 'credential_missing'
  | 'credential_invalid'
  | 'manifest_identity_missing'
  | 'identity_mismatch'
  | 'portfolio_identity_missing'
  | 'secret_store_unavailable';

export interface CoinbaseConnectionView {
  readonly asOfMs: number;
  readonly profileId: string;
  readonly provider: 'coinbase';
  readonly state: CoinbaseConnectionState;
  readonly reasonCode: CoinbaseConnectionReasonCode | null;
  readonly permissionMode: 'view_only' | 'unknown';
  readonly portfolioIdentityVerified: boolean;
  readonly readOnly: true;
  readonly executionAuthority: false;
  readonly transferAuthority: false;
  readonly receiveAuthority: false;
}

export type CoinbaseConnectionIssueCode =
  | 'invalid_profile_id'
  | 'profile_not_found'
  | 'invalid_key_name'
  | 'invalid_private_key'
  | 'unsupported_algorithm'
  | 'invalid_coinbase_key_file'
  | 'coinbase_verification_timeout'
  | 'coinbase_verification_network'
  | 'coinbase_verification_cancelled'
  | 'coinbase_verification_shutdown'
  | 'coinbase_verification_elapsed_budget'
  | 'coinbase_verification_unauthorized'
  | 'coinbase_verification_forbidden'
  | 'coinbase_verification_rate_limited'
  | 'coinbase_verification_http'
  | 'coinbase_verification_invalid_permissions'
  | 'coinbase_verification_missing_view_permission'
  | 'coinbase_verification_excess_permissions'
  | 'coinbase_verification_accounts_unreadable'
  | 'coinbase_portfolio_identity_invalid'
  | 'coinbase_verification_failed'
  | 'duplicate_coinbase_connection'
  | 'secret_store_unavailable'
  | 'secret_store_rejected'
  | 'profile_store_unavailable'
  | 'profile_store_corrupt'
  | 'profile_store_conflict'
  | 'profile_store_rejected'
  | 'profile_operation_in_progress'
  | 'coinbase_connection_invalid_clock'
  | 'coinbase_connection_recovery_required';

export interface CoinbaseConnectionIssue {
  readonly path: readonly string[];
  readonly code: CoinbaseConnectionIssueCode;
}

export type CoinbaseConnectionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly CoinbaseConnectionIssue[] };

export type CoinbaseCredentialVerificationResult =
  | { readonly ok: true; readonly portfolioUuid: string }
  | {
    readonly ok: false;
    readonly reasonCode: CoinbaseProbeErrorCode | 'invalid_portfolio_identity' | 'unexpected_failure';
  };

export interface CoinbaseCredentialVerifier {
  verify(
    credentials: CoinbaseCredentials,
    signal?: AbortSignal,
  ): Promise<CoinbaseCredentialVerificationResult>;
}

export type CoinbaseReadClientFactory = (
  credentials: CoinbaseCredentials,
) => CoinbaseReadHttpClient;

export interface CoinbaseConnectionDependencies {
  readonly clock: Clock;
  readonly manifestStore: ProfileManifestStore;
  readonly secretStore: SecretStore;
  readonly verifier: CoinbaseCredentialVerifier;
  readonly operationGate?: ProfileOperationGate;
}

const VERIFICATION_ISSUES: Readonly<
  Record<
    Exclude<CoinbaseCredentialVerificationResult, { ok: true }>['reasonCode'],
    CoinbaseConnectionIssueCode
  >
> = Object.freeze({
  timeout: 'coinbase_verification_timeout',
  network: 'coinbase_verification_network',
  cancelled: 'coinbase_verification_cancelled',
  shutdown: 'coinbase_verification_shutdown',
  elapsed_budget_exhausted: 'coinbase_verification_elapsed_budget',
  unauthorized: 'coinbase_verification_unauthorized',
  forbidden: 'coinbase_verification_forbidden',
  rate_limited: 'coinbase_verification_rate_limited',
  http: 'coinbase_verification_http',
  invalid_permissions: 'coinbase_verification_invalid_permissions',
  missing_view_permission: 'coinbase_verification_missing_view_permission',
  excess_permissions: 'coinbase_verification_excess_permissions',
  accounts_unreadable: 'coinbase_verification_accounts_unreadable',
  invalid_portfolio_identity: 'coinbase_portfolio_identity_invalid',
  unexpected_failure: 'coinbase_verification_failed',
});

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function issue(path: readonly string[], code: CoinbaseConnectionIssueCode): CoinbaseConnectionIssue {
  return freeze({ path: [...path], code });
}

function failure(
  path: readonly string[],
  code: CoinbaseConnectionIssueCode,
): CoinbaseConnectionResult<never> {
  return freeze({ ok: false, issues: [issue(path, code)] });
}

function safeNow(clock: Clock): number | null {
  try {
    const value = clock.nowMs();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function secretIssue(code: SecretStoreErrorCode): CoinbaseConnectionResult<never> {
  return failure(
    ['credentials'],
    code === 'unavailable' ? 'secret_store_unavailable' : 'secret_store_rejected',
  );
}

function view(
  asOfMs: number,
  profileId: string,
  state: CoinbaseConnectionState,
  reasonCode: CoinbaseConnectionReasonCode | null,
): CoinbaseConnectionView {
  const connected = state === 'connected';
  return freeze({
    asOfMs,
    profileId,
    provider: 'coinbase',
    state,
    reasonCode,
    permissionMode: connected ? 'view_only' : 'unknown',
    portfolioIdentityVerified: connected,
    readOnly: true,
    executionAuthority: false,
    transferAuthority: false,
    receiveAuthority: false,
  });
}

function readManifest(
  store: ProfileManifestStore,
): CoinbaseConnectionResult<ProfileManifestSnapshot> {
  let loaded: ReturnType<ProfileManifestStore['read']>;
  try {
    loaded = store.read();
  } catch {
    return failure([], 'profile_store_unavailable');
  }
  if (!loaded.ok) {
    return failure([], loaded.code === 'corrupt'
      ? 'profile_store_corrupt' : 'profile_store_unavailable');
  }
  return loaded.value === null
    ? failure([], 'profile_store_unavailable')
    : freeze({ ok: true, value: loaded.value });
}

function profile(
  snapshot: ProfileManifestSnapshot,
  profileId: string,
): StoredProfileRecord | null {
  return snapshot.manifest.profiles.find((candidate) => candidate.id === profileId) ?? null;
}

function replaceIssue(
  code: Exclude<ReturnType<ProfileManifestStore['replace']>, { ok: true }>['code'],
): CoinbaseConnectionIssueCode {
  if (code === 'conflict') return 'profile_store_conflict';
  if (code === 'unavailable') return 'profile_store_unavailable';
  return 'profile_store_rejected';
}

function withIdentity(
  snapshot: ProfileManifestSnapshot,
  profileId: string,
  keyFingerprint: string,
  portfolioFingerprint: string,
) {
  return {
    ...snapshot.manifest,
    profiles: snapshot.manifest.profiles.map((candidate) => candidate.id === profileId
      ? { ...candidate, coinbaseKeyFingerprint: keyFingerprint, coinbasePortfolioFingerprint: portfolioFingerprint }
      : candidate),
  };
}

function withoutIdentity(snapshot: ProfileManifestSnapshot, profileId: string) {
  return {
    ...snapshot.manifest,
    profiles: snapshot.manifest.profiles.map((candidate) => {
      if (candidate.id !== profileId) return candidate;
      const updated = { ...candidate };
      delete updated.coinbaseKeyFingerprint;
      delete updated.coinbasePortfolioFingerprint;
      return updated;
    }),
  };
}

async function restoreSecret(
  store: SecretStore,
  profileId: string,
  previous: string | null,
): Promise<boolean> {
  const restored = previous === null
    ? await store.remove('coinbase-credentials', profileId)
    : await store.write('coinbase-credentials', previous, profileId);
  return restored.ok;
}

/** Adapt the hardened GET-only Coinbase client and probe to a diagnostic-free service boundary. */
export function createCoinbaseViewOnlyVerifier(
  clientFactory: CoinbaseReadClientFactory = (credentials) =>
    createCoinbaseReadHttpClient(credentials),
): CoinbaseCredentialVerifier {
  return Object.freeze({
    async verify(
      credentials: CoinbaseCredentials,
      signal?: AbortSignal,
    ): Promise<CoinbaseCredentialVerificationResult> {
      let client: CoinbaseReadHttpClient | null = null;
      try {
        client = clientFactory(credentials);
        const result = await probeCoinbaseViewOnlyPermissions(client, signal);
        if (!result.ok) return { ok: false, reasonCode: result.code };
        const portfolioUuid = result.portfolioUuid?.trim().toLowerCase() ?? '';
        return UUID.test(portfolioUuid)
          ? { ok: true, portfolioUuid }
          : { ok: false, reasonCode: 'invalid_portfolio_identity' };
      } catch {
        return { ok: false, reasonCode: 'unexpected_failure' };
      } finally {
        client?.destroy();
      }
    },
  });
}

/** Profile-scoped, view-only Coinbase credential publication with derived recovery state. */
export class CoinbaseConnectionService {
  readonly #clock: Clock;
  readonly #manifestStore: ProfileManifestStore;
  readonly #secretStore: SecretStore;
  readonly #verifier: CoinbaseCredentialVerifier;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: CoinbaseConnectionDependencies) {
    this.#clock = dependencies.clock;
    this.#manifestStore = dependencies.manifestStore;
    this.#secretStore = dependencies.secretStore;
    this.#verifier = dependencies.verifier;
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  async status(profileId: string): Promise<CoinbaseConnectionResult<CoinbaseConnectionView>> {
    if (!PROFILE_ID.test(profileId)) return failure(['profileId'], 'invalid_profile_id');
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      const loaded = readManifest(this.#manifestStore);
      if (!loaded.ok) return loaded;
      const record = profile(loaded.value, profileId);
      if (record === null) return failure(['profileId'], 'profile_not_found');
      const asOfMs = safeNow(this.#clock);
      if (asOfMs === null) return failure([], 'coinbase_connection_invalid_clock');
      const stored = await this.#secretStore.read('coinbase-credentials', profileId);
      if (!stored.ok) {
        return freeze({
          ok: true,
          value: stored.code === 'unavailable'
            ? view(asOfMs, profileId, 'unavailable', 'secret_store_unavailable')
            : view(asOfMs, profileId, 'attention_required', 'credential_invalid'),
        });
      }
      if (stored.value === null) {
        const hasIdentity = record.coinbaseKeyFingerprint !== undefined ||
          record.coinbasePortfolioFingerprint !== undefined;
        return freeze({
          ok: true,
          value: view(
            asOfMs,
            profileId,
            hasIdentity ? 'attention_required' : 'disconnected',
            hasIdentity ? 'credential_missing' : null,
          ),
        });
      }
      const parsed = parseStoredCoinbaseCredentials(stored.value);
      if (parsed === null || !validateCoinbaseCredentials(parsed).ok) {
        return freeze({
          ok: true,
          value: view(asOfMs, profileId, 'attention_required', 'credential_invalid'),
        });
      }
      const keyFingerprint = sha256Hex(parsed.keyName);
      const reasonCode: CoinbaseConnectionReasonCode | null =
        record.coinbaseKeyFingerprint === undefined
          ? 'manifest_identity_missing'
          : record.coinbaseKeyFingerprint !== keyFingerprint
            ? 'identity_mismatch'
            : record.coinbasePortfolioFingerprint === undefined
              ? 'portfolio_identity_missing'
              : null;
      return freeze({
        ok: true,
        value: view(
          asOfMs,
          profileId,
          reasonCode === null ? 'connected' : 'attention_required',
          reasonCode,
        ),
      });
    } finally {
      this.#operationGate.end();
    }
  }

  async connectJson(
    profileId: string,
    contents: string,
    signal?: AbortSignal,
  ): Promise<CoinbaseConnectionResult<CoinbaseConnectionView>> {
    if (typeof contents !== 'string') {
      return failure(['credentials'], 'invalid_coinbase_key_file');
    }
    const parsed = parseCoinbaseKeyFileJson(contents);
    return parsed.ok
      ? await this.connect(profileId, parsed.credentials, signal)
      : failure(['credentials'], 'invalid_coinbase_key_file');
  }

  async connect(
    profileId: string,
    credentials: CoinbaseCredentials,
    signal?: AbortSignal,
  ): Promise<CoinbaseConnectionResult<CoinbaseConnectionView>> {
    if (!PROFILE_ID.test(profileId)) return failure(['profileId'], 'invalid_profile_id');
    if (
      credentials === null ||
      typeof credentials !== 'object' ||
      typeof credentials.keyName !== 'string'
    ) {
      return failure(['keyName'], 'invalid_key_name');
    }
    if (typeof credentials.privateKey !== 'string') {
      return failure(['privateKey'], 'invalid_private_key');
    }
    const validated = validateCoinbaseCredentials(credentials);
    if (!validated.ok) return failure(
      [validated.code === 'invalid_key_name' ? 'keyName' : 'privateKey'],
      validated.code,
    );
    const preliminary = readManifest(this.#manifestStore);
    if (!preliminary.ok) return preliminary;
    if (profile(preliminary.value, profileId) === null) {
      return failure(['profileId'], 'profile_not_found');
    }
    const asOfMs = safeNow(this.#clock);
    if (asOfMs === null) return failure([], 'coinbase_connection_invalid_clock');
    if (signal?.aborted) return failure([], 'coinbase_verification_cancelled');
    let verified: CoinbaseCredentialVerificationResult;
    try {
      verified = await this.#verifier.verify(validated.credentials, signal);
    } catch {
      verified = { ok: false, reasonCode: 'unexpected_failure' };
    }
    if (!verified.ok) return failure([], VERIFICATION_ISSUES[verified.reasonCode]);

    const keyFingerprint = sha256Hex(validated.credentials.keyName);
    const portfolioFingerprint = sha256Hex(verified.portfolioUuid);
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      const current = readManifest(this.#manifestStore);
      if (!current.ok) return current;
      const record = profile(current.value, profileId);
      if (record === null) return failure(['profileId'], 'profile_not_found');
      const duplicate = current.value.manifest.profiles.some((candidate) =>
        candidate.id !== profileId &&
        (
          candidate.coinbaseKeyFingerprint === keyFingerprint ||
          candidate.coinbasePortfolioFingerprint === portfolioFingerprint
        ));
      if (duplicate) return failure([], 'duplicate_coinbase_connection');

      const previous = await this.#secretStore.read('coinbase-credentials', profileId);
      if (!previous.ok) return secretIssue(previous.code);
      const stored = await this.#secretStore.write(
        'coinbase-credentials',
        serializeCoinbaseCredentials(validated.credentials),
        profileId,
      );
      if (!stored.ok) return secretIssue(stored.code);
      const replaced = this.#manifestStore.replace(
        current.value.revision,
        withIdentity(current.value, profileId, keyFingerprint, portfolioFingerprint),
      );
      if (!replaced.ok) {
        const restored = await restoreSecret(this.#secretStore, profileId, previous.value);
        return restored
          ? failure([], replaceIssue(replaced.code))
          : failure([], 'coinbase_connection_recovery_required');
      }
      return freeze({
        ok: true,
        value: view(asOfMs, profileId, 'connected', null),
      });
    } finally {
      this.#operationGate.end();
    }
  }

  async disconnect(profileId: string): Promise<CoinbaseConnectionResult<CoinbaseConnectionView>> {
    if (!PROFILE_ID.test(profileId)) return failure(['profileId'], 'invalid_profile_id');
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      const current = readManifest(this.#manifestStore);
      if (!current.ok) return current;
      const record = profile(current.value, profileId);
      if (record === null) return failure(['profileId'], 'profile_not_found');
      const asOfMs = safeNow(this.#clock);
      if (asOfMs === null) return failure([], 'coinbase_connection_invalid_clock');
      const previous = await this.#secretStore.read('coinbase-credentials', profileId);
      if (!previous.ok) return secretIssue(previous.code);
      if (
        previous.value === null &&
        record.coinbaseKeyFingerprint === undefined &&
        record.coinbasePortfolioFingerprint === undefined
      ) {
        return freeze({
          ok: true,
          value: view(asOfMs, profileId, 'disconnected', null),
        });
      }
      const removed = await this.#secretStore.remove('coinbase-credentials', profileId);
      if (!removed.ok) return secretIssue(removed.code);
      const replaced = this.#manifestStore.replace(
        current.value.revision,
        withoutIdentity(current.value, profileId),
      );
      if (!replaced.ok) {
        const restored = await restoreSecret(this.#secretStore, profileId, previous.value);
        return restored
          ? failure([], replaceIssue(replaced.code))
          : failure([], 'coinbase_connection_recovery_required');
      }
      return freeze({
        ok: true,
        value: view(asOfMs, profileId, 'disconnected', null),
      });
    } finally {
      this.#operationGate.end();
    }
  }
}
