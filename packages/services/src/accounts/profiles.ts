import type { Clock } from '@coqui/core';
import {
  PROFILE_COLORS,
  PROFILE_ICONS,
  type ProfileColor,
  type ProfileIcon,
  type ProfileManifestSnapshot,
  type ProfileManifestStore,
  type ProfileManifestStoreErrorCode,
  type ProfileManifestV1,
  type StoredProfileRecord,
} from '@coqui/storage';

import type {
  AccountProfileIssue,
  AccountProfileIssueCode,
  AccountProfileResult,
} from './results.js';

export type {
  AccountProfileIssue,
  AccountProfileIssueCode,
  AccountProfileResult,
} from './results.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_PROFILES = 32;

export interface ProfileIdSource {
  nextId(): string;
}

export interface ProfileDatabaseProvisioner {
  provision(profileId: string, dbFilename: string): Promise<{ readonly ok: boolean }>;
}

export interface PreparedProfileContext {
  /** Atomically activate the prepared context; `ok: false` must leave the old context active. */
  commit(): Promise<{ readonly ok: boolean }>;
  /** Idempotently release a context that was prepared but not activated. */
  abort(): Promise<void>;
}

export interface ProfileContextManager {
  /** Prepare and migrate the target without changing the currently active context. */
  prepare(
    profileId: string,
    dbFilename: string,
  ): Promise<
    | { readonly ok: true; readonly context: PreparedProfileContext }
    | { readonly ok: false }
  >;
}

export interface ProfileOperationGate {
  isBusy(): boolean;
  begin(): boolean;
  end(): void;
}

export function createProfileOperationGate(): ProfileOperationGate {
  let switching = false;
  return Object.freeze({
    isBusy: () => switching,
    begin: () => {
      if (switching) return false;
      switching = true;
      return true;
    },
    end: () => { switching = false; },
  });
}

export interface AccountsProfileDependencies {
  readonly clock: Clock;
  readonly idSource: ProfileIdSource;
  readonly manifestStore: ProfileManifestStore;
  readonly databaseProvisioner: ProfileDatabaseProvisioner;
  readonly contextManager?: ProfileContextManager;
  readonly operationGate?: ProfileOperationGate;
}

export interface AccountProfileView {
  readonly id: string;
  readonly name: string;
  readonly color: ProfileColor;
  readonly icon: ProfileIcon;
  readonly isActive: boolean;
  readonly createdAtMs: number;
  readonly lastOpenedAtMs: number;
  readonly order: number;
}

export interface CreateAccountProfileInput {
  readonly name: string;
  readonly color?: ProfileColor;
  readonly icon?: ProfileIcon;
}

export interface UpdateAccountProfileInput {
  readonly id: string;
  readonly name?: string;
  readonly color?: ProfileColor;
  readonly icon?: ProfileIcon;
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

function storeFailure(code: ProfileManifestStoreErrorCode): AccountProfileResult<never> {
  const mapped: AccountProfileIssueCode = code === 'unavailable'
    ? 'profile_store_unavailable'
    : code === 'corrupt'
      ? 'profile_store_corrupt'
      : code === 'conflict'
        ? 'profile_store_conflict'
        : 'profile_store_rejected';
  return failure([], mapped);
}

function readSnapshot(store: ProfileManifestStore): AccountProfileResult<ProfileManifestSnapshot | null> {
  const result = store.read();
  return result.ok ? freeze({ ok: true, value: result.value }) : storeFailure(result.code);
}

function safeNow(clock: Clock): number {
  const value = clock.nowMs();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Accounts clock must return a non-negative safe epoch millisecond.');
  }
  return value;
}

function canonicalName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/gu, ' ');
  if (name.length === 0 || name.length > 40) return null;
  const unsafe = [...name].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  return unsafe ? null : name;
}

function validColor(value: unknown): value is ProfileColor {
  return typeof value === 'string' && (PROFILE_COLORS as readonly string[]).includes(value);
}

function validIcon(value: unknown): value is ProfileIcon {
  return typeof value === 'string' && (PROFILE_ICONS as readonly string[]).includes(value);
}

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(record, key)) &&
    Object.keys(record).every((key) => allowed.has(key));
}

function view(profile: StoredProfileRecord, activeProfileId: string): AccountProfileView {
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

function views(manifest: ProfileManifestV1): readonly AccountProfileView[] {
  return freeze([...manifest.profiles]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((profile) => view(profile, manifest.activeProfileId)));
}

function nextColor(profiles: readonly StoredProfileRecord[]): ProfileColor {
  const counts = new Map<ProfileColor, number>(PROFILE_COLORS.map((color) => [color, 0]));
  for (const profile of profiles) counts.set(profile.color, (counts.get(profile.color) ?? 0) + 1);
  return PROFILE_COLORS.reduce((best, color) =>
    (counts.get(color) ?? 0) < (counts.get(best) ?? 0) ? color : best,
  PROFILE_COLORS[0]);
}

/**
 * Own secret-free profile metadata. Database context switching, credential
 * copying, and destructive profile removal are deliberately separate slices.
 */
export class AccountsProfileService {
  readonly #clock: Clock;
  readonly #idSource: ProfileIdSource;
  readonly #manifestStore: ProfileManifestStore;
  readonly #databaseProvisioner: ProfileDatabaseProvisioner;
  readonly #contextManager: ProfileContextManager;
  readonly #operationGate: ProfileOperationGate;

  constructor(dependencies: AccountsProfileDependencies) {
    this.#clock = dependencies.clock;
    this.#idSource = dependencies.idSource;
    this.#manifestStore = dependencies.manifestStore;
    this.#databaseProvisioner = dependencies.databaseProvisioner;
    this.#contextManager = dependencies.contextManager ?? {
      prepare: async () => ({ ok: false }),
    };
    this.#operationGate = dependencies.operationGate ?? createProfileOperationGate();
  }

  initializeMain(legacyDbFilename: string): AccountProfileResult<AccountProfileView> {
    if (
      typeof legacyDbFilename !== 'string' || legacyDbFilename.length === 0 ||
      legacyDbFilename.length > 128 || legacyDbFilename.includes('\0') ||
      legacyDbFilename.includes('/') || legacyDbFilename.includes('\\') ||
      !legacyDbFilename.endsWith('.db')
    ) return failure(['legacyDbFilename'], 'invalid_database_filename');
    if (this.#operationGate.isBusy()) return failure([], 'profile_operation_in_progress');
    const loaded = readSnapshot(this.#manifestStore);
    if (!loaded.ok) return loaded;
    if (loaded.value) {
      const active = loaded.value.manifest.profiles.find(
        (profile) => profile.id === loaded.value?.manifest.activeProfileId,
      );
      return active
        ? freeze({ ok: true, value: view(active, loaded.value.manifest.activeProfileId) })
        : failure([], 'profile_store_corrupt');
    }
    const now = safeNow(this.#clock);
    const profile: StoredProfileRecord = {
      id: 'main', name: 'Main Wallet', color: PROFILE_COLORS[0], icon: PROFILE_ICONS[0],
      dbFilename: legacyDbFilename, createdAt: now, lastOpenedAt: now, order: 0,
    };
    const manifest: ProfileManifestV1 = {
      version: 1, activeProfileId: 'main', profiles: [profile],
    };
    const saved = this.#manifestStore.replace(null, manifest);
    return saved.ok
      ? freeze({ ok: true, value: view(profile, 'main') })
      : storeFailure(saved.code);
  }

  list(): AccountProfileResult<readonly AccountProfileView[]> {
    if (this.#operationGate.isBusy()) return failure([], 'profile_operation_in_progress');
    const loaded = readSnapshot(this.#manifestStore);
    if (!loaded.ok) return loaded;
    return freeze({
      ok: true,
      value: loaded.value ? views(loaded.value.manifest) : freeze([]),
    });
  }

  active(): AccountProfileResult<AccountProfileView | null> {
    if (this.#operationGate.isBusy()) return failure([], 'profile_operation_in_progress');
    const loaded = readSnapshot(this.#manifestStore);
    if (!loaded.ok) return loaded;
    if (!loaded.value) return freeze({ ok: true, value: null });
    const active = loaded.value.manifest.profiles.find(
      (profile) => profile.id === loaded.value?.manifest.activeProfileId,
    );
    return active
      ? freeze({ ok: true, value: view(active, loaded.value.manifest.activeProfileId) })
      : failure([], 'profile_store_corrupt');
  }

  async create(input: CreateAccountProfileInput): Promise<AccountProfileResult<AccountProfileView>> {
    const issues: AccountProfileIssue[] = [];
    if (!exactKeys(input, ['name'], ['color', 'icon'])) issues.push(issue([], 'unknown_field'));
    const name = canonicalName(input?.name);
    if (name === null) issues.push(issue(['name'], 'invalid_name'));
    if (input?.color !== undefined && !validColor(input.color)) {
      issues.push(issue(['color'], 'invalid_color'));
    }
    if (input?.icon !== undefined && !validIcon(input.icon)) {
      issues.push(issue(['icon'], 'invalid_icon'));
    }
    if (issues.length > 0) return freeze({ ok: false, issues });
    if (this.#operationGate.isBusy()) return failure([], 'profile_operation_in_progress');

    const loaded = readSnapshot(this.#manifestStore);
    if (!loaded.ok) return loaded;
    if (!loaded.value) return failure([], 'profile_store_rejected');
    if (loaded.value.manifest.profiles.length >= MAX_PROFILES) {
      return failure([], 'profile_limit_reached');
    }
    const generated = this.#idSource.nextId();
    if (typeof generated !== 'string' || !UUID_V4.test(generated)) {
      return failure([], 'invalid_id_source');
    }
    const id = generated.toLowerCase();
    if (loaded.value.manifest.profiles.some((profile) => profile.id === id)) {
      return failure([], 'invalid_id_source');
    }
    const now = safeNow(this.#clock);
    const profile: StoredProfileRecord = {
      id,
      name: name!,
      color: validColor(input.color) ? input.color : nextColor(loaded.value.manifest.profiles),
      icon: validIcon(input.icon) ? input.icon : PROFILE_ICONS[0],
      dbFilename: `wallet-${id}.db`,
      createdAt: now,
      lastOpenedAt: now,
      order: loaded.value.manifest.profiles.length,
    };
    let provisioned: { readonly ok: boolean };
    try {
      provisioned = await this.#databaseProvisioner.provision(id, profile.dbFilename);
    } catch {
      return failure([], 'database_provision_failed');
    }
    if (!provisioned.ok) return failure([], 'database_provision_failed');
    const manifest: ProfileManifestV1 = {
      ...loaded.value.manifest,
      profiles: [...loaded.value.manifest.profiles, profile],
    };
    const saved = this.#manifestStore.replace(loaded.value.revision, manifest);
    return saved.ok
      ? freeze({ ok: true, value: view(profile, manifest.activeProfileId) })
      : storeFailure(saved.code);
  }

  update(input: UpdateAccountProfileInput): AccountProfileResult<AccountProfileView> {
    const issues: AccountProfileIssue[] = [];
    if (!exactKeys(input, ['id'], ['name', 'color', 'icon'])) issues.push(issue([], 'unknown_field'));
    if (typeof input?.id !== 'string' || (input.id !== 'main' && !UUID_V4.test(input.id))) {
      issues.push(issue(['id'], 'invalid_profile_id'));
    }
    if (input?.name !== undefined && canonicalName(input.name) === null) {
      issues.push(issue(['name'], 'invalid_name'));
    }
    if (input?.color !== undefined && !validColor(input.color)) {
      issues.push(issue(['color'], 'invalid_color'));
    }
    if (input?.icon !== undefined && !validIcon(input.icon)) {
      issues.push(issue(['icon'], 'invalid_icon'));
    }
    if (input && input.name === undefined && input.color === undefined && input.icon === undefined) {
      issues.push(issue([], 'empty_patch'));
    }
    if (issues.length > 0) return freeze({ ok: false, issues });
    if (this.#operationGate.isBusy()) return failure([], 'profile_operation_in_progress');

    const loaded = readSnapshot(this.#manifestStore);
    if (!loaded.ok) return loaded;
    if (!loaded.value) return failure(['id'], 'profile_not_found');
    const prior = loaded.value.manifest.profiles.find((profile) => profile.id === input.id);
    if (!prior) return failure(['id'], 'profile_not_found');
    const updated: StoredProfileRecord = {
      ...prior,
      ...(input.name !== undefined ? { name: canonicalName(input.name)! } : {}),
      ...(validColor(input.color) ? { color: input.color } : {}),
      ...(validIcon(input.icon) ? { icon: input.icon } : {}),
    };
    const manifest: ProfileManifestV1 = {
      ...loaded.value.manifest,
      profiles: loaded.value.manifest.profiles.map((profile) =>
        profile.id === updated.id ? updated : profile),
    };
    const saved = this.#manifestStore.replace(loaded.value.revision, manifest);
    return saved.ok
      ? freeze({ ok: true, value: view(updated, manifest.activeProfileId) })
      : storeFailure(saved.code);
  }

  reorder(orderedIds: readonly string[]): AccountProfileResult<readonly AccountProfileView[]> {
    if (!Array.isArray(orderedIds)) return failure(['orderedIds'], 'invalid_permutation');
    if (this.#operationGate.isBusy()) return failure([], 'profile_operation_in_progress');
    const loaded = readSnapshot(this.#manifestStore);
    if (!loaded.ok) return loaded;
    if (!loaded.value) return failure(['orderedIds'], 'invalid_permutation');
    const current = new Set(loaded.value.manifest.profiles.map((profile) => profile.id));
    const requested = new Set(orderedIds);
    if (
      orderedIds.length !== current.size || requested.size !== orderedIds.length ||
      [...current].some((id) => !requested.has(id)) ||
      orderedIds.some((id) => typeof id !== 'string')
    ) return failure(['orderedIds'], 'invalid_permutation');
    const order = new Map(orderedIds.map((id, index) => [id, index]));
    const manifest: ProfileManifestV1 = {
      ...loaded.value.manifest,
      profiles: loaded.value.manifest.profiles.map((profile) => ({
        ...profile, order: order.get(profile.id)!,
      })),
    };
    const saved = this.#manifestStore.replace(loaded.value.revision, manifest);
    return saved.ok
      ? freeze({ ok: true, value: views(manifest) })
      : storeFailure(saved.code);
  }

  async switchActive(profileId: string): Promise<AccountProfileResult<AccountProfileView>> {
    if (
      typeof profileId !== 'string' ||
      (profileId !== 'main' && !UUID_V4.test(profileId))
    ) return failure(['profileId'], 'invalid_profile_id');
    if (this.#operationGate.isBusy()) return failure([], 'profile_operation_in_progress');

    const loaded = readSnapshot(this.#manifestStore);
    if (!loaded.ok) return loaded;
    if (!loaded.value) return failure(['profileId'], 'profile_not_found');
    const target = loaded.value.manifest.profiles.find((profile) => profile.id === profileId);
    if (!target) return failure(['profileId'], 'profile_not_found');
    if (target.id === loaded.value.manifest.activeProfileId) {
      return freeze({ ok: true, value: view(target, target.id) });
    }

    const openedAt = safeNow(this.#clock);
    if (!this.#operationGate.begin()) return failure([], 'profile_operation_in_progress');
    try {
      let preparation:
        | { readonly ok: true; readonly context: PreparedProfileContext }
        | { readonly ok: false };
      try {
        preparation = await this.#contextManager.prepare(target.id, target.dbFilename);
      } catch {
        return failure([], 'context_prepare_failed');
      }
      if (!preparation.ok) return failure([], 'context_prepare_failed');
      const prepared = preparation.context;

      const updatedTarget: StoredProfileRecord = { ...target, lastOpenedAt: openedAt };
      const updatedManifest: ProfileManifestV1 = {
        ...loaded.value.manifest,
        activeProfileId: target.id,
        profiles: loaded.value.manifest.profiles.map((profile) =>
          profile.id === target.id ? updatedTarget : profile),
      };
      const published = this.#manifestStore.replace(loaded.value.revision, updatedManifest);
      if (!published.ok) {
        try {
          await prepared.abort();
        } catch {
          return failure([], 'context_recovery_required');
        }
        return storeFailure(published.code);
      }

      let committed: { readonly ok: boolean };
      try {
        committed = await prepared.commit();
      } catch {
        // A thrown commit violates the manager contract, so context state is
        // unknowable. Keep the durable target selection for restart recovery.
        return failure([], 'context_recovery_required');
      }
      if (!committed.ok) {
        const rolledBack = this.#manifestStore.replace(
          published.revision,
          loaded.value.manifest,
        );
        try {
          await prepared.abort();
        } catch {
          return failure([], 'context_recovery_required');
        }
        return rolledBack.ok
          ? failure([], 'context_commit_failed')
          : failure([], 'context_recovery_required');
      }
      return freeze({ ok: true, value: view(updatedTarget, target.id) });
    } finally {
      this.#operationGate.end();
    }
  }
}
