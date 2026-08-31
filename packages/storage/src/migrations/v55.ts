import type { Migration } from './types.js';

/** Signed presentation-only chart extensions and immutable lifecycle evidence. */
export const migrations55: readonly Migration[] = [{
  version: 55,
  name: 'signed_chart_extensions_v1',
  up: (db) => {
    db.exec(`
      CREATE TABLE chart_extension_signers_v1 (
        profile_id TEXT NOT NULL,
        key_id TEXT NOT NULL,
        display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
        public_key_base64 TEXT NOT NULL,
        trusted_at_ms INTEGER NOT NULL CHECK (trusted_at_ms >= 0),
        revoked_at_ms INTEGER,
        PRIMARY KEY (profile_id, key_id)
      );
      CREATE TABLE chart_extensions_v1 (
        profile_id TEXT NOT NULL,
        extension_id TEXT NOT NULL,
        version TEXT NOT NULL,
        signer_key_id TEXT NOT NULL,
        manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        package_blob BLOB NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        settings_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings_json)),
        installed_at_ms INTEGER NOT NULL CHECK (installed_at_ms >= 0),
        PRIMARY KEY (profile_id, extension_id)
      );
      CREATE TABLE chart_extension_events_v1 (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        extension_id TEXT NOT NULL,
        event TEXT NOT NULL CHECK (event IN ('installed', 'enabled', 'disabled', 'updated', 'uninstalled', 'signer_revoked', 'failed')),
        detail_code TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0)
      );
      CREATE TRIGGER chart_extension_events_v1_no_update BEFORE UPDATE ON chart_extension_events_v1
        BEGIN SELECT RAISE(ABORT, 'chart extension events are immutable'); END;
      CREATE TRIGGER chart_extension_events_v1_no_delete BEFORE DELETE ON chart_extension_events_v1
        BEGIN SELECT RAISE(ABORT, 'chart extension events are immutable'); END;
    `);
  },
}];
