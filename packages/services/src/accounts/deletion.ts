import type { SecretStore } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import {
  type ProfileBackupStore,
  type ProfileDeletionStore,
  type ProfileDeletionStoreErrorCode,
  type ProfileManifestStore,
  type StoredProfileBackupCredentialKind,
  type StoredProfileDeletionImpact,
  type StoredProfileDeletionTicket,
} from '@coqui/storage';

import type {
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

export interface ProfileDeletionIdSource {
  nextId(): string;
}

export interface ProfileCredentialRemover {
  remove(
    profileId: string,
    kind: StoredProfileBackupCredentialKind,
  ): Promise<{ readonly ok: boolean }>;
}

export interface ProfileDeletionConfirmation {
  readonly action: 'delete_profile_permanently';
  readonly profileId: string;
  readonly backupId: string;
  readonly acknowledgeCredentialRemoval: true;
}

export interface DeleteAccountProfileInput {
  readonly profileId: string;
  readonly backupArtifactName: string;
  readonly confirmation: ProfileDeletionConfirmation;
}

export interface ProfileDeletionOutcome {
  readonly profileId: string;
  readonly backupId: string;
  readonly backupArtifactName: string;
  readonly recoveryId: string;
  readonly deleted: true;
  readonly cleanupStatus: 'complete' | 'pending';
  readonly databaseCleanupPending: boolean;
  readonly credentialCleanupPending: readonly StoredProfileBackupCredentialKind[];
  readonly journalCleanupPending: boolean;
}

export interface AccountsProfileDeletionDependencies {
  readonly clock: Clock;
  readonly idSource: ProfileDeletionIdSource;
  readonly manifestStore: ProfileManifestStore;
  readonly impactReader: ProfileDeletionImpactReader;
  readonly credentialPresence: ProfileCredentialPresenceSource;
  readonly credentialRemover: ProfileCredentialRemover;
  readonly backupStore: ProfileBackupStore;
  readonly deletionStore: ProfileDeletionStore;
  readonly operationGate?: ProfileOperationGate;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function failure(path: readonly string[], code: AccountProfileIssueCode): AccountProfileResult<never> {
  const issue: AccountProfileIssue = freeze({ path: [...path], code });
  return freeze({ ok: false, issues: [issue] });
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validProfileId(value: unknown): value is string {
  return value === 'main' || typeof value === 'string' && UUID_V4.test(value);
}

function validImpact(value: unknown): value is StoredProfileDeletionImpact {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === IMPACT_KEYS.length && IMPACT_KEYS.every((key) => {
    const count = record[key];
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  });
}

function sameImpact(left: StoredProfileDeletionImpact, right: StoredProfileDeletionImpact): boolean {
  return IMPACT_KEYS.every((key) => left[key] === right[key]);
}

function validKinds(value: unknown): value is readonly StoredProfileBackupCredentialKind[] {
  return Array.isArray(value) && value.length === new Set(value).size && value.every(
    (kind) => kind === 'coinbase' || kind === 'advisor_gemini',
  );
}

function sameKinds(
  left: readonly StoredProfileBackupCredentialKind[],
  right: readonly StoredProfileBackupCredentialKind[],
): boolean {
  return [...left].sort().join(':') === [...right].sort().join(':');
}

function storeFailure(code: ProfileDeletionStoreErrorCode): AccountProfileResult<never> {
  const mapped: AccountProfileIssueCode = code === 'profile_not_found'
    ? 'profile_not_found'
    : code === 'active_profile'
      ? 'profile_backup_active'
      : code === 'last_profile'
        ? 'profile_backup_last_profile'
        : code === 'source_unavailable'
          ? 'profile_delete_source_unavailable'
          : code === 'manifest_conflict'
            ? 'profile_delete_manifest_conflict'
            : code === 'recovery_corrupt'
              ? 'profile_delete_recovery_corrupt'
              : code === 'journal_unavailable'
                ? 'profile_delete_journal_unavailable'
                : code === 'manifest_unavailable'
                  ? 'profile_store_unavailable'
                  : 'profile_delete_invalid_metadata';
  return failure([], mapped);
}

function outcome(
  ticket: StoredProfileDeletionTicket,
  journalCleanupPending: boolean,
): ProfileDeletionOutcome {
  const pendingKinds = ticket.credentialKinds.filter(
    (kind) => !ticket.removedCredentialKinds.includes(kind),
  );
  const pending = !ticket.databaseRemoved || pendingKinds.length > 0 || journalCleanupPending;
  return freeze({
    profileId: ticket.profileId,
    backupId: ticket.backupId,
    backupArtifactName: ticket.backupArtifactName,
    recoveryId: ticket.operationId,
    deleted: true,
    cleanupStatus: pending ? 'pending' : 'complete',
    databaseCleanupPending: !ticket.databaseRemoved,
    credentialCleanupPending: pendingKinds,
    journalCleanupPending,
  });
}

/** Remove only the two profile-scoped credentials represented by backup metadata. */
export function createProfileCredentialRemover(secretStore: SecretStore): ProfileCredentialRemover {
  return Object.freeze({
    async remove(profileId: string, kind: StoredProfileBackupCredentialKind) {
      const key = kind === 'coinbase' ? 'coinbase-credentials' : 'gemini-api-key';
      const result = await secretStore.remove(key, profileId);
      return { ok: result.ok };
    },
  });
}

/** Backup-gated, explicitly confirmed profile deletion with durable cleanup recovery. */
export class AccountsProfileDeletionService {
  readonly #clock: Clock;
  readonly #idSource: ProfileDeletionIdSource;
  readonly #manifestStore: ProfileManifestStore;
  readonly #impactReader: ProfileDeletionImpactReader;
  readonly #credentialPresence: ProfileCredentialPresenceSource;
  readonly #credentialRemover: ProfileCredentialRemover;
  readonly #backupStore: ProfileBackupStore;
  readonly #deletionStore: ProfileDeletionStore;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: AccountsProfileDeletionDependencies) {
    this.#clock = dependencies.clock;
    this.#idSource = dependencies.idSource;
    this.#manifestStore = dependencies.manifestStore;
    this.#impactReader = dependencies.impactReader;
    this.#credentialPresence = dependencies.credentialPresence;
    this.#credentialRemover = dependencies.credentialRemover;
    this.#backupStore = dependencies.backupStore;
    this.#deletionStore = dependencies.deletionStore;
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  async delete(input: DeleteAccountProfileInput): Promise<AccountProfileResult<ProfileDeletionOutcome>> {
    if (!exactKeys(input, ['profileId', 'backupArtifactName', 'confirmation'])) {
      return failure([], 'unknown_field');
    }
    if (!validProfileId(input.profileId)) return failure(['profileId'], 'invalid_profile_id');
    if (!exactKeys(input.confirmation, [
      'action', 'profileId', 'backupId', 'acknowledgeCredentialRemoval',
    ]) || input.confirmation.action !== 'delete_profile_permanently' ||
      input.confirmation.profileId !== input.profileId ||
      !UUID_V4.test(input.confirmation.backupId) ||
      input.confirmation.acknowledgeCredentialRemoval !== true) {
      return failure(['confirmation'], 'profile_delete_confirmation_required');
    }
    if (typeof input.backupArtifactName !== 'string' || input.backupArtifactName.length === 0) {
      return failure(['backupArtifactName'], 'profile_backup_invalid_artifact');
    }
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      let loaded: ReturnType<ProfileManifestStore['read']>;
      try {
        loaded = this.#manifestStore.read();
      } catch {
        return failure([], 'profile_store_unavailable');
      }
      if (!loaded.ok) return failure([], loaded.code === 'corrupt'
        ? 'profile_store_corrupt'
        : 'profile_store_unavailable');
      if (!loaded.value) return failure(['profileId'], 'profile_not_found');
      const profile = loaded.value.manifest.profiles.find((candidate) => candidate.id === input.profileId);
      if (!profile) return failure(['profileId'], 'profile_not_found');
      if (loaded.value.manifest.profiles.length === 1) {
        return failure(['profileId'], 'profile_backup_last_profile');
      }
      if (loaded.value.manifest.activeProfileId === profile.id) {
        return failure(['profileId'], 'profile_backup_active');
      }

      let verified: Awaited<ReturnType<ProfileBackupStore['verify']>>;
      try {
        verified = await this.#backupStore.verify(input.backupArtifactName, profile.id);
      } catch {
        return failure([], 'profile_backup_verification_failed');
      }
      if (!verified.ok) return failure([], 'profile_backup_verification_failed');
      const backup = verified.backup;
      if (backup.backupId !== input.confirmation.backupId.toLowerCase() ||
        backup.sourceManifestRevision !== loaded.value.revision) {
        return failure([], 'profile_delete_backup_stale');
      }

      const [impactResult, credentialResult] = await Promise.allSettled([
        this.#impactReader.inspect(profile.id, profile.dbFilename),
        this.#credentialPresence.inspect(profile.id),
      ]);
      if (impactResult.status !== 'fulfilled' || !impactResult.value.ok ||
        !validImpact(impactResult.value.impact)) {
        return failure([], 'profile_delete_impact_unavailable');
      }
      if (credentialResult.status !== 'fulfilled' || !credentialResult.value.ok ||
        !validKinds(credentialResult.value.credentialKinds)) {
        return failure([], 'profile_delete_credentials_unavailable');
      }
      if (!sameImpact(impactResult.value.impact, backup.impact) ||
        !sameKinds(credentialResult.value.credentialKinds, backup.credentialKinds)) {
        return failure([], 'profile_delete_backup_stale');
      }

      let createdAtMs: number;
      let operationId: string;
      try {
        createdAtMs = this.#clock.nowMs();
        operationId = this.#idSource.nextId();
      } catch {
        return failure([], 'profile_delete_invalid_metadata');
      }
      if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0 ||
        typeof operationId !== 'string' || !UUID_V4.test(operationId)) {
        return failure([], 'profile_delete_invalid_metadata');
      }
      let committed: Awaited<ReturnType<ProfileDeletionStore['commit']>>;
      try {
        committed = await this.#deletionStore.commit({
          operationId: operationId.toLowerCase(),
          profileId: profile.id,
          backupId: backup.backupId,
          backupArtifactName: backup.artifactName,
          sourceManifestRevision: loaded.value.revision,
          createdAtMs,
          credentialKinds: backup.credentialKinds,
        });
      } catch {
        return failure([], 'profile_delete_journal_unavailable');
      }
      if (!committed.ok) return storeFailure(committed.code);
      return freeze({ ok: true, value: await this.#finish(committed.value) });
    } finally {
      this.#operationGate.end();
    }
  }

  async resumePending(): Promise<AccountProfileResult<readonly ProfileDeletionOutcome[]>> {
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      let pending: Awaited<ReturnType<ProfileDeletionStore['pending']>>;
      try {
        pending = await this.#deletionStore.pending();
      } catch {
        return failure([], 'profile_delete_journal_unavailable');
      }
      if (!pending.ok) return storeFailure(pending.code);
      const results: ProfileDeletionOutcome[] = [];
      for (const ticket of pending.value) {
        let verified: Awaited<ReturnType<ProfileBackupStore['verify']>>;
        try {
          verified = await this.#backupStore.verify(ticket.backupArtifactName, ticket.profileId);
        } catch {
          verified = { ok: false, code: 'verification_failed' };
        }
        if (!verified.ok || verified.backup.backupId !== ticket.backupId) {
          results.push(outcome(ticket, true));
          continue;
        }
        results.push(await this.#finish(ticket));
      }
      return freeze({ ok: true, value: results });
    } finally {
      this.#operationGate.end();
    }
  }

  async #finish(initial: StoredProfileDeletionTicket): Promise<ProfileDeletionOutcome> {
    let current = initial;
    if (!current.databaseRemoved) {
      let cleaned: Awaited<ReturnType<ProfileDeletionStore['cleanupDatabase']>>;
      try {
        cleaned = await this.#deletionStore.cleanupDatabase(current.operationId);
      } catch {
        return outcome(current, true);
      }
      if (cleaned.ok) current = cleaned.value;
      else return outcome(current, true);
    }
    for (const kind of current.credentialKinds) {
      if (current.removedCredentialKinds.includes(kind)) continue;
      let removed: { readonly ok: boolean };
      try {
        removed = await this.#credentialRemover.remove(current.profileId, kind);
      } catch {
        removed = { ok: false };
      }
      if (!removed.ok) continue;
      let recorded: Awaited<ReturnType<ProfileDeletionStore['recordCredentialRemoved']>>;
      try {
        recorded = await this.#deletionStore.recordCredentialRemoved(current.operationId, kind);
      } catch {
        continue;
      }
      if (recorded.ok) current = recorded.value;
    }
    const allCredentialsRemoved = current.credentialKinds.every(
      (kind) => current.removedCredentialKinds.includes(kind),
    );
    if (current.databaseRemoved && allCredentialsRemoved) {
      let completed: Awaited<ReturnType<ProfileDeletionStore['complete']>>;
      try {
        completed = await this.#deletionStore.complete(current.operationId);
      } catch {
        return outcome(current, true);
      }
      if (completed.ok) return outcome(current, false);
    }
    return outcome(current, true);
  }
}
