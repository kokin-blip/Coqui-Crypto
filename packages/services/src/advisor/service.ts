import type { SecretStore, SecretStoreErrorCode } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import {
  getAdvisorProfileConfig,
  removeAdvisorProfileConfig,
  saveAdvisorProfileConfig,
  type Db,
  type StoredAdvisorModelPolicyId,
} from '@coqui/storage';

const PROFILE = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;

export const ADVISOR_MODEL_POLICIES = Object.freeze([
  'advisor_balanced_v1',
  'advisor_fast_v1',
] as const);

export const DEFAULT_ADVISOR_MODEL_POLICY: AdvisorModelPolicyId =
  'advisor_balanced_v1';

export type AdvisorModelPolicyId = StoredAdvisorModelPolicyId;
export type AdvisorCredentialState = 'connected' | 'disconnected' | 'unavailable';

export type AdvisorIssueCode =
  | 'invalid_profile'
  | 'invalid_api_key'
  | 'invalid_model_policy'
  | 'secret_store_unavailable'
  | 'secret_store_rejected'
  | 'storage_unavailable';

export interface AdvisorIssue {
  readonly path: readonly string[];
  readonly code: AdvisorIssueCode;
}

export interface AdvisorConnectionView {
  readonly asOfMs: number;
  readonly profileId: string;
  readonly provider: 'gemini';
  readonly credentialState: AdvisorCredentialState;
  readonly modelPolicyId: AdvisorModelPolicyId;
  readonly modelSource: 'default' | 'stored';
  readonly modelUpdatedAtMs: number | null;
  readonly advisoryOnly: true;
  readonly executionAuthority: false;
}

export interface AdvisorModelPolicyView {
  readonly profileId: string;
  readonly modelPolicyId: AdvisorModelPolicyId;
  readonly modelSource: 'stored';
  readonly updatedAtMs: number;
}

export type AdvisorResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly AdvisorIssue[] };

export interface AdvisorServiceDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly secretStore: SecretStore;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function issue(path: readonly string[], code: AdvisorIssueCode): AdvisorIssue {
  return freeze({ path: [...path], code });
}

function failure(path: readonly string[], code: AdvisorIssueCode): AdvisorResult<never> {
  return freeze({ ok: false, issues: [issue(path, code)] });
}

function validProfile(profileId: unknown): profileId is string {
  return typeof profileId === 'string' && PROFILE.test(profileId);
}

function validApiKey(apiKey: unknown): apiKey is string {
  if (typeof apiKey !== 'string' || apiKey.length < 20 || apiKey.length > 512) return false;
  return [...apiKey].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 33 && code <= 126;
  });
}

function validModelPolicy(value: unknown): value is AdvisorModelPolicyId {
  return typeof value === 'string' &&
    (ADVISOR_MODEL_POLICIES as readonly string[]).includes(value);
}

function safeNow(clock: Clock): number {
  const value = clock.nowMs();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Advisor clock must return a non-negative safe epoch millisecond.');
  }
  return value;
}

function secretFailure(code: SecretStoreErrorCode): AdvisorResult<never> {
  return failure(
    ['apiKey'],
    code === 'unavailable' ? 'secret_store_unavailable' : 'secret_store_rejected',
  );
}

function view(
  profileId: string,
  credentialState: AdvisorCredentialState,
  asOfMs: number,
  config: ReturnType<typeof getAdvisorProfileConfig>,
): AdvisorConnectionView {
  return freeze({
    asOfMs,
    profileId,
    provider: 'gemini',
    credentialState,
    modelPolicyId: config?.modelPolicyId ?? DEFAULT_ADVISOR_MODEL_POLICY,
    modelSource: config ? 'stored' : 'default',
    modelUpdatedAtMs: config?.updatedAt ?? null,
    advisoryOnly: true,
    executionAuthority: false,
  });
}

/**
 * Own advisor connection state without gaining access to chat, execution, or
 * credential persistence. Secret material remains inside the injected adapter.
 */
export class AdvisorConnectionService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #secretStore: SecretStore;

  constructor(dependencies: AdvisorServiceDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#secretStore = dependencies.secretStore;
  }

  async status(profileId: string): Promise<AdvisorResult<AdvisorConnectionView>> {
    if (!validProfile(profileId)) return failure(['profileId'], 'invalid_profile');
    const asOfMs = safeNow(this.#clock);
    let config: ReturnType<typeof getAdvisorProfileConfig>;
    try {
      config = getAdvisorProfileConfig(profileId, this.#database);
    } catch {
      return failure([], 'storage_unavailable');
    }
    const secret = await this.#secretStore.read('gemini-api-key', profileId);
    const credentialState: AdvisorCredentialState = !secret.ok
      ? 'unavailable'
      : secret.value === null ? 'disconnected' : 'connected';
    return freeze({ ok: true, value: view(profileId, credentialState, asOfMs, config) });
  }

  async connect(
    profileId: string,
    apiKey: string,
  ): Promise<AdvisorResult<AdvisorConnectionView>> {
    const issues: AdvisorIssue[] = [];
    if (!validProfile(profileId)) issues.push(issue(['profileId'], 'invalid_profile'));
    if (!validApiKey(apiKey)) issues.push(issue(['apiKey'], 'invalid_api_key'));
    if (issues.length > 0) return freeze({ ok: false, issues });

    const asOfMs = safeNow(this.#clock);
    let config: ReturnType<typeof getAdvisorProfileConfig>;
    try {
      config = getAdvisorProfileConfig(profileId, this.#database);
    } catch {
      return failure([], 'storage_unavailable');
    }
    const stored = await this.#secretStore.write('gemini-api-key', apiKey, profileId);
    if (!stored.ok) return secretFailure(stored.code);
    return freeze({ ok: true, value: view(profileId, 'connected', asOfMs, config) });
  }

  async disconnect(profileId: string): Promise<AdvisorResult<AdvisorConnectionView>> {
    if (!validProfile(profileId)) return failure(['profileId'], 'invalid_profile');
    const asOfMs = safeNow(this.#clock);
    const removed = await this.#secretStore.remove('gemini-api-key', profileId);
    if (!removed.ok) return secretFailure(removed.code);
    try {
      removeAdvisorProfileConfig(profileId, this.#database);
    } catch {
      return failure([], 'storage_unavailable');
    }
    return freeze({
      ok: true,
      value: view(profileId, 'disconnected', asOfMs, null),
    });
  }

  setModelPolicy(
    profileId: string,
    modelPolicyId: AdvisorModelPolicyId,
  ): AdvisorResult<AdvisorModelPolicyView> {
    const issues: AdvisorIssue[] = [];
    if (!validProfile(profileId)) issues.push(issue(['profileId'], 'invalid_profile'));
    if (!validModelPolicy(modelPolicyId)) {
      issues.push(issue(['modelPolicyId'], 'invalid_model_policy'));
    }
    if (issues.length > 0) return freeze({ ok: false, issues });

    const updatedAtMs = safeNow(this.#clock);
    try {
      saveAdvisorProfileConfig({ profileId, modelPolicyId, updatedAt: updatedAtMs }, this.#database);
    } catch {
      return failure([], 'storage_unavailable');
    }
    return freeze({
      ok: true,
      value: {
        profileId,
        modelPolicyId,
        modelSource: 'stored',
        updatedAtMs,
      },
    });
  }
}
