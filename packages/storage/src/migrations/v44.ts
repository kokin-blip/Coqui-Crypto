import type { Migration } from './types.js';

/** Typed profile presentation preferences; financial policies remain service-owned. */
export const migrations44: readonly Migration[] = [{
  version: 44,
  name: 'account_presentation_preferences_v1',
  up: (db) => {
    db.exec(`
      CREATE TABLE account_preferences_v1 (
        profile_id     TEXT PRIMARY KEY,
        theme          TEXT NOT NULL CHECK (
          theme IN ('system', 'light', 'dark', 'high_contrast')
        ),
        density        TEXT NOT NULL CHECK (density IN ('comfortable', 'compact')),
        motion         TEXT NOT NULL CHECK (motion IN ('system', 'reduced', 'none')),
        language       TEXT NOT NULL CHECK (language IN ('en', 'es')),
        updated_at_ms  INTEGER NOT NULL CHECK (updated_at_ms >= 0)
      );
    `);
  },
}];
