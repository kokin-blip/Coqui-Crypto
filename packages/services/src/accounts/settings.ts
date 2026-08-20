import type { Clock } from '@coqui/core';
import {
  inTransaction,
  readAccountPreferences,
  saveAccountPreferences,
  type AccountDensity,
  type AccountLanguage,
  type AccountMotion,
  type AccountTheme,
  type Db,
  type StoredAccountPreferences,
} from '@coqui/storage';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const ALLOWED = new Set(['theme', 'density', 'motion', 'language']);
const CROSS_DOMAIN = new Set([
  'baseCurrency', 'costBasisMethod', 'rebalanceBandPct', 'coinbasePrimary',
  'coinGeckoFallback', 'iznobSwearing', 'cashYieldAprPct', 'taxShortTermPct',
  'taxLongTermPct', 'venueCostProfile',
]);

export interface AccountPresentationPreferences {
  readonly theme: AccountTheme;
  readonly density: AccountDensity;
  readonly motion: AccountMotion;
  readonly language: AccountLanguage;
}

export const DEFAULT_ACCOUNT_PRESENTATION_PREFERENCES: AccountPresentationPreferences =
  Object.freeze({
    theme: 'system',
    density: 'comfortable',
    motion: 'system',
    language: 'en',
  });

export interface AccountPreferencesView {
  readonly profileId: string;
  readonly asOfMs: number;
  readonly updatedAtMs: number | null;
  readonly source: 'default' | 'saved';
  readonly preferences: AccountPresentationPreferences;
}

export type AccountSettingsIssueCode =
  | 'invalid_profile_id'
  | 'invalid_patch'
  | 'patch_too_large'
  | 'empty_patch'
  | 'unknown_field'
  | 'cross_domain_field'
  | 'invalid_theme'
  | 'invalid_density'
  | 'invalid_motion'
  | 'invalid_language'
  | 'clock_unavailable'
  | 'storage_unavailable'
  | 'storage_rejected';

export interface AccountSettingsIssue {
  readonly path: readonly string[];
  readonly code: AccountSettingsIssueCode;
}

export type AccountSettingsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly AccountSettingsIssue[] };

export interface AccountSettingsDependencies {
  readonly database: Db;
  readonly clock: Clock;
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function issue(path: readonly string[], code: AccountSettingsIssueCode): AccountSettingsIssue {
  return freeze({ path: [...path], code });
}

function failure(
  code: AccountSettingsIssueCode,
  path: readonly string[] = [],
): AccountSettingsResult<never> {
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

function preferences(value: StoredAccountPreferences | null): AccountPresentationPreferences {
  return value === null
    ? DEFAULT_ACCOUNT_PRESENTATION_PREFERENCES
    : freeze({
      theme: value.theme,
      density: value.density,
      motion: value.motion,
      language: value.language,
    });
}

function view(
  profileId: string,
  asOfMs: number,
  stored: StoredAccountPreferences | null,
): AccountPreferencesView {
  return freeze({
    profileId,
    asOfMs,
    updatedAtMs: stored?.updatedAtMs ?? null,
    source: stored === null ? 'default' : 'saved',
    preferences: preferences(stored),
  });
}

interface ValidatedPatch {
  theme?: AccountTheme;
  density?: AccountDensity;
  motion?: AccountMotion;
  language?: AccountLanguage;
}

function validatePatch(value: unknown):
  | { readonly ok: true; readonly patch: ValidatedPatch }
  | { readonly ok: false; readonly issues: readonly AccountSettingsIssue[] } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [issue([], 'invalid_patch')] };
  }
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length === 0) return { ok: false, issues: [issue([], 'empty_patch')] };
  if (keys.length > 32) return { ok: false, issues: [issue([], 'patch_too_large')] };
  const issues: AccountSettingsIssue[] = [];
  const patch: ValidatedPatch = {};
  for (const key of keys) {
    if (!ALLOWED.has(key)) {
      issues.push(issue([key], CROSS_DOMAIN.has(key) ? 'cross_domain_field' : 'unknown_field'));
      continue;
    }
    const field = row[key];
    if (key === 'theme') {
      if (field === 'system' || field === 'light' || field === 'dark' || field === 'high_contrast') {
        patch.theme = field;
      } else issues.push(issue([key], 'invalid_theme'));
    } else if (key === 'density') {
      if (field === 'comfortable' || field === 'compact') patch.density = field;
      else issues.push(issue([key], 'invalid_density'));
    } else if (key === 'motion') {
      if (field === 'system' || field === 'reduced' || field === 'none') patch.motion = field;
      else issues.push(issue([key], 'invalid_motion'));
    } else if (key === 'language') {
      if (field === 'en' || field === 'es') patch.language = field;
      else issues.push(issue([key], 'invalid_language'));
    }
  }
  return issues.length > 0
    ? { ok: false, issues: freeze(issues) }
    : { ok: true, patch };
}

/** Own only profile presentation preferences; financial and provider policy stays elsewhere. */
export class AccountSettingsService {
  readonly #database: Db;
  readonly #clock: Clock;

  constructor(dependencies: AccountSettingsDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
  }

  get(profileId: string): AccountSettingsResult<AccountPreferencesView> {
    if (!PROFILE_ID.test(profileId)) return failure('invalid_profile_id', ['profileId']);
    const asOfMs = safeNow(this.#clock);
    if (asOfMs === null) return failure('clock_unavailable');
    try {
      const stored = readAccountPreferences(profileId, this.#database);
      if (stored !== null && stored.updatedAtMs > asOfMs) return failure('clock_unavailable');
      return freeze({ ok: true, value: view(profileId, asOfMs, stored) });
    } catch {
      return failure('storage_unavailable');
    }
  }

  set(profileId: string, patchValue: unknown): AccountSettingsResult<AccountPreferencesView> {
    if (!PROFILE_ID.test(profileId)) return failure('invalid_profile_id', ['profileId']);
    const validated = validatePatch(patchValue);
    if (!validated.ok) return freeze({ ok: false, issues: validated.issues });
    const updatedAtMs = safeNow(this.#clock);
    if (updatedAtMs === null) return failure('clock_unavailable');
    try {
      const stored = inTransaction(this.#database, () => {
        const prior = readAccountPreferences(profileId, this.#database);
        if (prior !== null && prior.updatedAtMs > updatedAtMs) return null;
        const current = preferences(prior);
        return saveAccountPreferences({
          profileId,
          theme: validated.patch.theme ?? current.theme,
          density: validated.patch.density ?? current.density,
          motion: validated.patch.motion ?? current.motion,
          language: validated.patch.language ?? current.language,
          updatedAtMs,
        }, this.#database);
      });
      if (stored === null) return failure('clock_unavailable');
      return freeze({ ok: true, value: view(profileId, updatedAtMs, stored) });
    } catch {
      return failure('storage_rejected');
    }
  }
}
