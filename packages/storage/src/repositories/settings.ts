import type { Db } from '../sqlite/index.js';

/** Read one persisted application setting without applying domain defaults. */
export function getSetting(key: string, database: Db): string | null {
  const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

/** Persist one application setting through a bound value. */
export function setSetting(key: string, value: string, database: Db): void {
  if (!key.trim()) throw new TypeError('A setting key is required.');
  database.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function removeSetting(key: string, database: Db): boolean {
  const result = database.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  return Number(result.changes) > 0;
}
