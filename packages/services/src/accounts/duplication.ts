import type { Clock } from '@coqui/core';
import {
  PROFILE_COLORS,
  PROFILE_ICONS,
  type ProfileColor,
  type ProfileDatabaseDuplicationErrorCode,
  type ProfileDatabaseDuplicationEvidence,
  type ProfileDatabaseDuplicator,
  type ProfileIcon,
  type ProfileManifestStore,
  type ProfileManifestStoreErrorCode,
  type ProfileManifestV1,
  type StoredProfileRecord,
} from '@coqui/storage';

import {
  createProfileOperationGate,
  type AccountProfileIssue,
  type AccountProfileIssueCode,
  type AccountProfileResult,
  type AccountProfileView,
  type ProfileIdSource,
  type ProfileOperationGate,
} from './profiles.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PROFILES = 32;

export interface DuplicateAccountProfileInput {
  readonly sourceProfileId: string;
  readonly name: string;
  readonly color?: ProfileColor;
  readonly icon?: ProfileIcon;
}

export interface ProfileDuplicationResult {
  readonly sourceProfileId: string;
  readonly profile: AccountProfileView;
  readonly schemaVersion: number;
  readonly databaseSha256: string;
  readonly profileScopedTableCount: number;
  readonly rewrittenRowCount: number;
  readonly excludedTransientRowCount: number;
  readonly clearedCredentialMetadataCount: number;
  readonly credentialsCopied: false;
  readonly providerFingerprintsCopied: false;
}

export interface AccountsProfileDuplicationDependencies {
  readonly clock: Clock;
  readonly idSource: ProfileIdSource;
  readonly manifestStore: ProfileManifestStore;
  readonly databaseDuplicator: ProfileDatabaseDuplicator;
  readonly operationGate?: ProfileOperationGate;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function issue(path: readonly string[], code: AccountProfileIssueCode): AccountProfileIssue {
  return freeze({ path: [...path], code });
}

function failure(path: readonly string[], code: AccountProfileIssueCode): AccountProfileResult<never> {
  return freeze({ ok: false, issues: [issue(path, code)] });
}

function exactKeys(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const required = ['sourceProfileId', 'name'];
  const allowed = new Set([...required, 'color', 'icon']);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function canonicalName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/gu, ' ');
  if (name.length === 0 || name.length > 40) return null;
  return [...name].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  }) ? null : name;
}

function validProfileId(value: unknown): value is string {
  return value === 'main' || typeof value === 'string' && UUID_V4.test(value);
}

function validColor(value: unknown): value is ProfileColor {
  return typeof value === 'string' && (PROFILE_COLORS as readonly string[]).includes(value);
}

function validIcon(value: unknown): value is ProfileIcon {
  return typeof value === 'string' && (PROFILE_ICONS as readonly string[]).includes(value);
}

function storeFailure(code: ProfileManifestStoreErrorCode): AccountProfileResult<never> {
  return failure([], code === 'corrupt' ? 'profile_store_corrupt'
    : code === 'conflict' ? 'profile_store_conflict'
      : code === 'invalid_manifest' ? 'profile_store_rejected'
        : 'profile_store_unavailable');
}

function duplicateFailure(code: ProfileDatabaseDuplicationErrorCode): AccountProfileResult<never> {
  const mapped: AccountProfileIssueCode = code === 'source_unavailable'
    ? 'profile_duplicate_source_unavailable'
    : code === 'destination_conflict'
      ? 'profile_duplicate_destination_conflict'
      : code === 'destination_unavailable'
        ? 'profile_duplicate_destination_unavailable'
        : code === 'foreign_profile_identity'
          ? 'profile_duplicate_foreign_identity'
          : code === 'verification_failed'
            ? 'profile_duplicate_verification_failed'
            : 'profile_duplicate_invalid_metadata';
  return failure([], mapped);
}

function profileView(profile: StoredProfileRecord, activeProfileId: string): AccountProfileView {
  return freeze({
    id: profile.id,
    name: profile.name,
    color: profile.color,
    icon: profile.icon,
    isActive: profile.id === activeProfileId,
    createdAtMs: profile.createdAt,
    lastOpenedAtMs: profile.lastOpenedAt,
    order: profile.order,
  });
}

function resultView(
  sourceProfileId: string,
  profile: StoredProfileRecord,
  activeProfileId: string,
  evidence: ProfileDatabaseDuplicationEvidence,
): ProfileDuplicationResult {
  return freeze({
    sourceProfileId,
    profile: profileView(profile, activeProfileId),
    schemaVersion: evidence.schemaVersion,
    databaseSha256: evidence.databaseSha256,
    profileScopedTableCount: evidence.profileScopedTableCount,
    rewrittenRowCount: evidence.rewrittenRowCount,
    excludedTransientRowCount: evidence.excludedTransientRowCount,
    clearedCredentialMetadataCount: evidence.clearedCredentialMetadataCount,
    credentialsCopied: false,
    providerFingerprintsCopied: false,
  });
}

/** Duplicate permitted local state while assigning a new canonical profile identity. */
export class AccountsProfileDuplicationService {
  readonly #clock: Clock;
  readonly #idSource: ProfileIdSource;
  readonly #manifestStore: ProfileManifestStore;
  readonly #databaseDuplicator: ProfileDatabaseDuplicator;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: AccountsProfileDuplicationDependencies) {
    this.#clock = dependencies.clock;
    this.#idSource = dependencies.idSource;
    this.#manifestStore = dependencies.manifestStore;
    this.#databaseDuplicator = dependencies.databaseDuplicator;
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  async duplicate(
    input: DuplicateAccountProfileInput,
  ): Promise<AccountProfileResult<ProfileDuplicationResult>> {
    const issues: AccountProfileIssue[] = [];
    if (!exactKeys(input)) issues.push(issue([], 'unknown_field'));
    if (!validProfileId(input?.sourceProfileId)) {
      issues.push(issue(['sourceProfileId'], 'invalid_profile_id'));
    }
    const name = canonicalName(input?.name);
    if (name === null) issues.push(issue(['name'], 'invalid_name'));
    if (input?.color !== undefined && !validColor(input.color)) {
      issues.push(issue(['color'], 'invalid_color'));
    }
    if (input?.icon !== undefined && !validIcon(input.icon)) {
      issues.push(issue(['icon'], 'invalid_icon'));
    }
    if (issues.length > 0) return freeze({ ok: false, issues });
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      let loaded: ReturnType<ProfileManifestStore['read']>;
      try {
        loaded = this.#manifestStore.read();
      } catch {
        return failure([], 'profile_store_unavailable');
      }
      if (!loaded.ok) return storeFailure(loaded.code);
      if (!loaded.value) return failure(['sourceProfileId'], 'profile_not_found');
      if (loaded.value.manifest.profiles.length >= MAX_PROFILES) {
        return failure([], 'profile_limit_reached');
      }
      const source = loaded.value.manifest.profiles.find(
        (profile) => profile.id === input.sourceProfileId,
      );
      if (!source) return failure(['sourceProfileId'], 'profile_not_found');

      let generated: string;
      let now: number;
      try {
        generated = this.#idSource.nextId();
        now = this.#clock.nowMs();
      } catch {
        return failure([], 'profile_duplicate_invalid_metadata');
      }
      if (typeof generated !== 'string' || !UUID_V4.test(generated) || loaded.value.manifest.profiles.some(
        (profile) => profile.id.toLowerCase() === generated.toLowerCase(),
      ) || !Number.isSafeInteger(now) || now < 0) {
        return failure([], 'profile_duplicate_invalid_metadata');
      }
      const id = generated.toLowerCase();
      const duplicated: StoredProfileRecord = {
        id,
        name: name!,
        color: validColor(input.color) ? input.color : source.color,
        icon: validIcon(input.icon) ? input.icon : source.icon,
        dbFilename: `wallet-${id}.db`,
        createdAt: now,
        lastOpenedAt: now,
        order: loaded.value.manifest.profiles.length,
      };
      let copied: Awaited<ReturnType<ProfileDatabaseDuplicator['duplicate']>>;
      try {
        copied = await this.#databaseDuplicator.duplicate({
          sourceProfileId: source.id,
          sourceDbFilename: source.dbFilename,
          targetProfileId: duplicated.id,
          targetDbFilename: duplicated.dbFilename,
        });
      } catch {
        return failure([], 'profile_duplicate_destination_unavailable');
      }
      if (!copied.ok) return duplicateFailure(copied.code);

      const manifest: ProfileManifestV1 = {
        ...loaded.value.manifest,
        profiles: [...loaded.value.manifest.profiles, duplicated],
      };
      let saved: ReturnType<ProfileManifestStore['replace']>;
      try {
        saved = this.#manifestStore.replace(loaded.value.revision, manifest);
      } catch {
        saved = { ok: false, code: 'unavailable' };
      }
      if (!saved.ok) {
        let current: ReturnType<ProfileManifestStore['read']>;
        try {
          current = this.#manifestStore.read();
        } catch {
          return failure([], 'profile_duplicate_cleanup_required');
        }
        if (!current.ok || current.value?.manifest.profiles.some(
          (profile) => profile.id === duplicated.id || profile.dbFilename === duplicated.dbFilename,
        )) return failure([], 'profile_duplicate_cleanup_required');
        let discarded: { readonly ok: boolean };
        try {
          discarded = await this.#databaseDuplicator.discard(duplicated.id, duplicated.dbFilename);
        } catch {
          discarded = { ok: false };
        }
        return discarded.ok ? storeFailure(saved.code) : failure([], 'profile_duplicate_cleanup_required');
      }
      return freeze({
        ok: true,
        value: resultView(source.id, duplicated, manifest.activeProfileId, copied.evidence),
      });
    } finally {
      this.#operationGate.end();
    }
  }
}
