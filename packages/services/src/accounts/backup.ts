import type { Clock } from '@coqui/core';
import {
  type ProfileBackupErrorCode,
  type ProfileBackupStore,
  type ProfileManifestStore,
  type StoredProfileDeletionImpact,
  type VerifiedProfileBackup,
} from '@coqui/storage';

import type {
  ProfileCredentialKind,
  ProfileCredentialPresenceSource,
  ProfileDeletionImpactReader,
} from './deletion-preview.js';
import {
  createProfileOperationGate,
  type AccountProfileIssue,
  type AccountProfileIssueCode,
  type AccountProfileResult,
  type ProfileOperationGate,
} from './profiles.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IMPACT_KEYS = [
  'openTaxLots', 'disposals', 'portfolioEvidenceRecords', 'paperEvidenceRecords',
  'researchEvidenceRecords', 'alertEvidenceRecords', 'importEvidenceRecords',
  'operationalEvidenceRecords',
] as const;

export interface ProfileBackupIdSource {
  nextId(): string;
}

export interface AccountsProfileBackupDependencies {
  readonly clock: Clock;
  readonly idSource: ProfileBackupIdSource;
  readonly manifestStore: ProfileManifestStore;
  readonly impactReader: ProfileDeletionImpactReader;
  readonly credentialPresence: ProfileCredentialPresenceSource;
  readonly backupStore: ProfileBackupStore;
  readonly operationGate?: ProfileOperationGate;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function failure(
  path: readonly string[],
  code: AccountProfileIssueCode,
): AccountProfileResult<never> {
  const issue: AccountProfileIssue = freeze({ path: [...path], code });
  return freeze({ ok: false, issues: [issue] });
}

function validProfileId(value: unknown): value is string {
  return value === 'main' || typeof value === 'string' && UUID_V4.test(value);
}

function validImpact(value: unknown): value is StoredProfileDeletionImpact {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== IMPACT_KEYS.length) return false;
  let total = 0;
  for (const key of IMPACT_KEYS) {
    const count = record[key];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return false;
    total += count;
  }
  return Number.isSafeInteger(total);
}

function validCredentialKinds(value: unknown): value is readonly ProfileCredentialKind[] {
  return Array.isArray(value) && value.length === new Set(value).size && value.every(
    (kind) => kind === 'coinbase' || kind === 'advisor_gemini',
  );
}

function backupFailure(code: ProfileBackupErrorCode): AccountProfileResult<never> {
  const mapped: AccountProfileIssueCode = code === 'invalid_input'
    ? 'profile_backup_invalid_artifact'
    : code === 'source_unavailable'
      ? 'profile_backup_source_unavailable'
      : code === 'destination_unavailable'
        ? 'profile_backup_destination_unavailable'
        : code === 'artifact_conflict'
          ? 'profile_backup_conflict'
          : 'profile_backup_verification_failed';
  return failure([], mapped);
}

/** Create and independently re-verify recoverable backups without secret-value authority. */
export class AccountsProfileBackupService {
  readonly #clock: Clock;
  readonly #idSource: ProfileBackupIdSource;
  readonly #manifestStore: ProfileManifestStore;
  readonly #impactReader: ProfileDeletionImpactReader;
  readonly #credentialPresence: ProfileCredentialPresenceSource;
  readonly #backupStore: ProfileBackupStore;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: AccountsProfileBackupDependencies) {
    this.#clock = dependencies.clock;
    this.#idSource = dependencies.idSource;
    this.#manifestStore = dependencies.manifestStore;
    this.#impactReader = dependencies.impactReader;
    this.#credentialPresence = dependencies.credentialPresence;
    this.#backupStore = dependencies.backupStore;
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  async create(profileId: string): Promise<AccountProfileResult<VerifiedProfileBackup>> {
    if (!validProfileId(profileId)) return failure(['profileId'], 'invalid_profile_id');
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      let loaded: ReturnType<ProfileManifestStore['read']>;
      try {
        loaded = this.#manifestStore.read();
      } catch {
        return failure([], 'profile_store_unavailable');
      }
      if (!loaded.ok) {
        return failure([], loaded.code === 'corrupt'
          ? 'profile_store_corrupt'
          : 'profile_store_unavailable');
      }
      if (!loaded.value) return failure(['profileId'], 'profile_not_found');
      const profile = loaded.value.manifest.profiles.find((candidate) => candidate.id === profileId);
      if (!profile) return failure(['profileId'], 'profile_not_found');
      if (loaded.value.manifest.profiles.length === 1) {
        return failure(['profileId'], 'profile_backup_last_profile');
      }
      if (profile.id === loaded.value.manifest.activeProfileId) {
        return failure(['profileId'], 'profile_backup_active');
      }

      const [impactResult, credentialsResult] = await Promise.allSettled([
        this.#impactReader.inspect(profile.id, profile.dbFilename),
        this.#credentialPresence.inspect(profile.id),
      ]);
      if (
        impactResult.status !== 'fulfilled' || !impactResult.value.ok ||
        !validImpact(impactResult.value.impact)
      ) return failure([], 'profile_backup_impact_unavailable');
      if (
        credentialsResult.status !== 'fulfilled' || !credentialsResult.value.ok ||
        !validCredentialKinds(credentialsResult.value.credentialKinds)
      ) return failure([], 'profile_backup_credentials_unavailable');

      let createdAtMs: number;
      let backupId: string;
      try {
        createdAtMs = this.#clock.nowMs();
        backupId = this.#idSource.nextId();
      } catch {
        return failure([], 'profile_backup_invalid_metadata');
      }
      if (
        !Number.isSafeInteger(createdAtMs) || createdAtMs < 0 ||
        typeof backupId !== 'string' || !UUID_V4.test(backupId)
      ) return failure([], 'profile_backup_invalid_metadata');

      let result: Awaited<ReturnType<ProfileBackupStore['create']>>;
      try {
        result = await this.#backupStore.create({
          backupId: backupId.toLowerCase(),
          profileId: profile.id,
          profileName: profile.name,
          dbFilename: profile.dbFilename,
          createdAtMs,
          sourceManifestRevision: loaded.value.revision,
          impact: impactResult.value.impact,
          credentialKinds: [...credentialsResult.value.credentialKinds].sort(),
        });
      } catch {
        return failure([], 'profile_backup_destination_unavailable');
      }
      return result.ok
        ? freeze({ ok: true, value: result.backup })
        : backupFailure(result.code);
    } finally {
      this.#operationGate.end();
    }
  }

  async verify(
    profileId: string,
    artifactName: string,
  ): Promise<AccountProfileResult<VerifiedProfileBackup>> {
    if (!validProfileId(profileId)) return failure(['profileId'], 'invalid_profile_id');
    if (typeof artifactName !== 'string' || artifactName.length === 0) {
      return failure(['artifactName'], 'profile_backup_invalid_artifact');
    }
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      let result: Awaited<ReturnType<ProfileBackupStore['verify']>>;
      try {
        result = await this.#backupStore.verify(artifactName, profileId);
      } catch {
        return failure([], 'profile_backup_verification_failed');
      }
      return result.ok
        ? freeze({ ok: true, value: result.backup })
        : backupFailure(result.code);
    } finally {
      this.#operationGate.end();
    }
  }
}
