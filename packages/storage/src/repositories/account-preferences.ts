import type { Db } from '../sqlite/index.js';

const PROFILE_ID = /^(?:main|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

export type AccountTheme = 'system' | 'light' | 'dark' | 'high_contrast';
export type AccountDensity = 'comfortable' | 'compact';
export type AccountMotion = 'system' | 'reduced' | 'none';
export type AccountLanguage = 'en' | 'es';

export interface StoredAccountPreferences {
  readonly profileId: string;
  readonly theme: AccountTheme;
  readonly density: AccountDensity;
  readonly motion: AccountMotion;
  readonly language: AccountLanguage;
  readonly updatedAtMs: number;
}

interface PreferenceRow {
  profile_id: string;
  theme: AccountTheme;
  density: AccountDensity;
  motion: AccountMotion;
  language: AccountLanguage;
  updated_at_ms: number;
}

function validTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validate(preferences: StoredAccountPreferences): void {
  if (!PROFILE_ID.test(preferences.profileId) ||
    !['system', 'light', 'dark', 'high_contrast'].includes(preferences.theme) ||
    !['comfortable', 'compact'].includes(preferences.density) ||
    !['system', 'reduced', 'none'].includes(preferences.motion) ||
    !['en', 'es'].includes(preferences.language) || !validTime(preferences.updatedAtMs)) {
    throw new TypeError('Invalid account preferences.');
  }
}

export function readAccountPreferences(
  profileId: string,
  database: Db,
): StoredAccountPreferences | null {
  if (!PROFILE_ID.test(profileId)) throw new TypeError('Invalid profile identity.');
  const row = database.prepare('SELECT * FROM account_preferences_v1 WHERE profile_id = ?')
    .get(profileId) as unknown as PreferenceRow | undefined;
  if (row === undefined) return null;
  const preferences: StoredAccountPreferences = {
    profileId: row.profile_id,
    theme: row.theme,
    density: row.density,
    motion: row.motion,
    language: row.language,
    updatedAtMs: row.updated_at_ms,
  };
  validate(preferences);
  return Object.freeze(preferences);
}

/** Atomically replace one profile's complete validated presentation preferences. */
export function saveAccountPreferences(
  preferences: StoredAccountPreferences,
  database: Db,
): StoredAccountPreferences {
  validate(preferences);
  database.prepare(`INSERT INTO account_preferences_v1 (
    profile_id, theme, density, motion, language, updated_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(profile_id) DO UPDATE SET
    theme = excluded.theme, density = excluded.density, motion = excluded.motion,
    language = excluded.language, updated_at_ms = excluded.updated_at_ms`)
    .run(
      preferences.profileId, preferences.theme, preferences.density,
      preferences.motion, preferences.language, preferences.updatedAtMs,
    );
  return Object.freeze({ ...preferences });
}
