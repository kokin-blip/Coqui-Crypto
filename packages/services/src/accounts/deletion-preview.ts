import { readSecretPresence, type SecretStore } from '@coqui/adapters';
import type { Clock } from '@coqui/core';
import {
  type ProfileBackupStore,
  type ProfileManifestStore,
  type StoredProfileDeletionImpact,
} from '@coqui/storage';

import {
  createProfileOperationGate,
  type AccountProfileIssue,
  type AccountProfileResult,
  type ProfileOperationGate,
} from './profiles.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IMPACT_KEYS = [
  'openTaxLots', 'disposals', 'portfolioEvidenceRecords', 'paperEvidenceRecords',
  'researchEvidenceRecords', 'alertEvidenceRecords', 'importEvidenceRecords',
  'operationalEvidenceRecords',
] as const;

export type ProfileCredentialKind = 'coinbase' | 'advisor_gemini';

export interface ProfileDeletionImpactReader {
  inspect(
    profileId: string,
    dbFilename: string,
  ): Promise<
    | { readonly ok: true; readonly impact: StoredProfileDeletionImpact }
    | { readonly ok: false }
  >;
}

export interface ProfileCredentialPresenceSource {
  inspect(profileId: string): Promise<
    | { readonly ok: true; readonly credentialKinds: readonly ProfileCredentialKind[] }
    | { readonly ok: false }
  >;
}

export interface ProfileDeletionPreviewDependencies {
  readonly clock: Clock;
  readonly manifestStore: ProfileManifestStore;
  readonly impactReader: ProfileDeletionImpactReader;
  readonly credentialPresence: ProfileCredentialPresenceSource;
  readonly backupStore?: ProfileBackupStore;
  readonly operationGate?: ProfileOperationGate;
}

export type ProfileDeletionBlockerCode =
  | 'last_profile'
  | 'active_profile'
  | 'impact_unavailable'
  | 'credential_presence_unavailable'
  | 'recoverable_backup_required'
  | 'recoverable_backup_unverified'
  | 'recoverable_backup_stale';

export type ProfileDeletionWarningCode =
  | 'durable_evidence_present'
  | 'credentials_present';

export interface ProfileDeletionPreview {
  readonly asOfMs: number;
  readonly profileId: string;
  readonly profileName: string;
  readonly isActive: boolean;
  readonly isLastProfile: boolean;
  readonly inspectionStatus: 'complete' | 'incomplete';
  readonly impact: StoredProfileDeletionImpact | null;
  readonly totalDurableRecords: number | null;
  readonly credentialKinds: readonly ProfileCredentialKind[];
  readonly backupStatus: 'not_provided' | 'verified' | 'invalid' | 'stale';
  readonly backupId: string | null;
  readonly blockerCodes: readonly ProfileDeletionBlockerCode[];
  readonly warningCodes: readonly ProfileDeletionWarningCode[];
  readonly deletionEligible: boolean;
  readonly explicitConfirmationRequired: true;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function issue(path: readonly string[], code: AccountProfileIssue['code']): AccountProfileIssue {
  return freeze({ path: [...path], code });
}

function failure(
  path: readonly string[],
  code: AccountProfileIssue['code'],
): AccountProfileResult<never> {
  return freeze({ ok: false, issues: [issue(path, code)] });
}

function safeNow(clock: Clock): number {
  const value = clock.nowMs();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Accounts clock must return a non-negative safe epoch millisecond.');
  }
  return value;
}

function validImpact(value: unknown): value is StoredProfileDeletionImpact {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === IMPACT_KEYS.length && IMPACT_KEYS.every((key) => {
    const count = record[key];
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  });
}

function totalImpact(impact: StoredProfileDeletionImpact): number | null {
  const total = IMPACT_KEYS.reduce((sum, key) => sum + impact[key], 0);
  return Number.isSafeInteger(total) ? total : null;
}

function validCredentialKinds(value: unknown): value is readonly ProfileCredentialKind[] {
  return Array.isArray(value) && new Set(value).size === value.length && value.every(
    (kind) => kind === 'coinbase' || kind === 'advisor_gemini',
  );
}

function sameImpact(
  left: StoredProfileDeletionImpact,
  right: StoredProfileDeletionImpact,
): boolean {
  return IMPACT_KEYS.every((key) => left[key] === right[key]);
}

function sameCredentialKinds(
  left: readonly ProfileCredentialKind[],
  right: readonly ProfileCredentialKind[],
): boolean {
  return [...left].sort().join(':') === [...right].sort().join(':');
}

/** Build a value-free credential presence boundary over the OS secret adapter. */
export function createProfileCredentialPresenceSource(
  secretStore: SecretStore,
): ProfileCredentialPresenceSource {
  const source: ProfileCredentialPresenceSource = {
    async inspect(profileId: string) {
      const presence = await readSecretPresence(
        secretStore,
        ['coinbase-credentials', 'gemini-api-key'],
        profileId,
      );
      if (!presence.ok) return { ok: false as const };
      const kinds: ProfileCredentialKind[] = [];
      if (presence.present.includes('coinbase-credentials')) kinds.push('coinbase');
      if (presence.present.includes('gemini-api-key')) kinds.push('advisor_gemini');
      return { ok: true as const, credentialKinds: Object.freeze(kinds) };
    },
  };
  return Object.freeze(source);
}

/** Read a deletion consequence preview without gaining deletion or secret-value authority. */
export class AccountsProfileDeletionPreviewService {
  readonly #clock: Clock;
  readonly #manifestStore: ProfileManifestStore;
  readonly #impactReader: ProfileDeletionImpactReader;
  readonly #credentialPresence: ProfileCredentialPresenceSource;
  readonly #backupStore: ProfileBackupStore | undefined;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: ProfileDeletionPreviewDependencies) {
    this.#clock = dependencies.clock;
    this.#manifestStore = dependencies.manifestStore;
    this.#impactReader = dependencies.impactReader;
    this.#credentialPresence = dependencies.credentialPresence;
    this.#backupStore = dependencies.backupStore;
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  async preview(
    profileId: string,
    backupArtifactName?: string,
  ): Promise<AccountProfileResult<ProfileDeletionPreview>> {
    if (
      typeof profileId !== 'string' ||
      (profileId !== 'main' && !UUID_V4.test(profileId))
    ) return failure(['profileId'], 'invalid_profile_id');
    if (this.#operationGate.isBusy()) return failure([], 'profile_operation_in_progress');
    const loaded = this.#manifestStore.read();
    if (!loaded.ok) {
      return failure([], loaded.code === 'corrupt'
        ? 'profile_store_corrupt'
        : 'profile_store_unavailable');
    }
    if (!loaded.value) return failure(['profileId'], 'profile_not_found');
    const profile = loaded.value.manifest.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return failure(['profileId'], 'profile_not_found');
    const asOfMs = safeNow(this.#clock);

    const [impactResult, credentialsResult] = await Promise.allSettled([
      this.#impactReader.inspect(profile.id, profile.dbFilename),
      this.#credentialPresence.inspect(profile.id),
    ]);
    const impact = impactResult.status === 'fulfilled' && impactResult.value.ok &&
      validImpact(impactResult.value.impact)
      ? impactResult.value.impact
      : null;
    const credentialKinds = credentialsResult.status === 'fulfilled' &&
      credentialsResult.value.ok &&
      validCredentialKinds(credentialsResult.value.credentialKinds)
      ? [...credentialsResult.value.credentialKinds].sort()
      : null;
    const totalDurableRecords = impact === null ? null : totalImpact(impact);
    let backupStatus: ProfileDeletionPreview['backupStatus'] = 'not_provided';
    let backupId: string | null = null;
    if (backupArtifactName !== undefined) {
      if (typeof backupArtifactName !== 'string' || backupArtifactName.length === 0 ||
        this.#backupStore === undefined) {
        backupStatus = 'invalid';
      } else {
        try {
          const verified = await this.#backupStore.verify(backupArtifactName, profile.id);
          if (!verified.ok) {
            backupStatus = 'invalid';
          } else if (
            verified.backup.sourceManifestRevision !== loaded.value.revision ||
            impact === null || credentialKinds === null ||
            !sameImpact(verified.backup.impact, impact) ||
            !sameCredentialKinds(verified.backup.credentialKinds, credentialKinds)
          ) {
            backupStatus = 'stale';
          } else {
            backupStatus = 'verified';
            backupId = verified.backup.backupId;
          }
        } catch {
          backupStatus = 'invalid';
        }
      }
    }
    const isActive = loaded.value.manifest.activeProfileId === profile.id;
    const isLastProfile = loaded.value.manifest.profiles.length === 1;
    const blockerCodes: ProfileDeletionBlockerCode[] = [];
    if (isLastProfile) blockerCodes.push('last_profile');
    if (isActive) blockerCodes.push('active_profile');
    if (impact === null || totalDurableRecords === null) blockerCodes.push('impact_unavailable');
    if (credentialKinds === null) blockerCodes.push('credential_presence_unavailable');
    if (backupStatus === 'not_provided') blockerCodes.push('recoverable_backup_required');
    if (backupStatus === 'invalid') blockerCodes.push('recoverable_backup_unverified');
    if (backupStatus === 'stale') blockerCodes.push('recoverable_backup_stale');
    const warningCodes: ProfileDeletionWarningCode[] = [];
    if (totalDurableRecords !== null && totalDurableRecords > 0) {
      warningCodes.push('durable_evidence_present');
    }
    if (credentialKinds !== null && credentialKinds.length > 0) {
      warningCodes.push('credentials_present');
    }
    return freeze({
      ok: true,
      value: {
        asOfMs,
        profileId: profile.id,
        profileName: profile.name,
        isActive,
        isLastProfile,
        inspectionStatus: impact !== null && credentialKinds !== null &&
          totalDurableRecords !== null ? 'complete' : 'incomplete',
        impact,
        totalDurableRecords,
        credentialKinds: credentialKinds ?? [],
        backupStatus,
        backupId,
        blockerCodes,
        warningCodes,
        deletionEligible: blockerCodes.length === 0,
        explicitConfirmationRequired: true,
      },
    });
  }
}
