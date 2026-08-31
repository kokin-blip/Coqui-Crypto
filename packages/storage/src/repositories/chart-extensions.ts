import type { Db } from '../sqlite/index.js';

export interface StoredChartExtensionSigner { readonly profileId: string; readonly keyId: string;
  readonly displayName: string; readonly publicKeyBase64: string; readonly trustedAtMs: number;
  readonly revokedAtMs: number | null }
export interface StoredChartExtension { readonly profileId: string; readonly extensionId: string;
  readonly version: string; readonly signerKeyId: string; readonly manifestJson: string;
  readonly payloadHash: string; readonly packageBlob: Uint8Array; readonly enabled: boolean;
  readonly settingsJson: string; readonly installedAtMs: number }

export function listChartExtensionSigners(profileId: string, database: Db): StoredChartExtensionSigner[] {
  const rows = database.prepare('SELECT * FROM chart_extension_signers_v1 WHERE profile_id = ? ORDER BY display_name').all(profileId) as unknown as Array<{ profile_id: string; key_id: string; display_name: string; public_key_base64: string; trusted_at_ms: number; revoked_at_ms: number | null }>;
  return rows.map((row) => Object.freeze({ profileId: row.profile_id, keyId: row.key_id,
    displayName: row.display_name, publicKeyBase64: row.public_key_base64,
    trustedAtMs: row.trusted_at_ms, revokedAtMs: row.revoked_at_ms }));
}

export function saveChartExtensionSigner(value: StoredChartExtensionSigner, database: Db): void {
  database.prepare(`INSERT INTO chart_extension_signers_v1
    (profile_id, key_id, display_name, public_key_base64, trusted_at_ms, revoked_at_ms)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id, key_id) DO UPDATE SET
    display_name = excluded.display_name, public_key_base64 = excluded.public_key_base64,
    trusted_at_ms = excluded.trusted_at_ms, revoked_at_ms = excluded.revoked_at_ms`)
    .run(value.profileId, value.keyId, value.displayName, value.publicKeyBase64,
      value.trustedAtMs, value.revokedAtMs);
}

export function revokeChartExtensionSigner(profileId: string, keyId: string, atMs: number, database: Db): number {
  database.prepare('UPDATE chart_extension_signers_v1 SET revoked_at_ms = ? WHERE profile_id = ? AND key_id = ?').run(atMs, profileId, keyId);
  const disabled = database.prepare('UPDATE chart_extensions_v1 SET enabled = 0 WHERE profile_id = ? AND signer_key_id = ? AND enabled = 1').run(profileId, keyId).changes;
  return Number(disabled);
}

export function listChartExtensions(profileId: string, database: Db): StoredChartExtension[] {
  const rows = database.prepare('SELECT * FROM chart_extensions_v1 WHERE profile_id = ? ORDER BY extension_id').all(profileId) as unknown as Array<{ profile_id: string; extension_id: string; version: string; signer_key_id: string; manifest_json: string; payload_hash: string; package_blob: Uint8Array; enabled: number; settings_json: string; installed_at_ms: number }>;
  return rows.map((row) => Object.freeze({ profileId: row.profile_id, extensionId: row.extension_id,
    version: row.version, signerKeyId: row.signer_key_id, manifestJson: row.manifest_json,
    payloadHash: row.payload_hash, packageBlob: row.package_blob, enabled: row.enabled === 1,
    settingsJson: row.settings_json, installedAtMs: row.installed_at_ms }));
}

export function getChartExtension(profileId: string, extensionId: string, database: Db): StoredChartExtension | null {
  return listChartExtensions(profileId, database).find((item) => item.extensionId === extensionId) ?? null;
}

export function saveChartExtension(value: StoredChartExtension, database: Db): boolean {
  const exists = getChartExtension(value.profileId, value.extensionId, database) !== null;
  database.prepare(`INSERT INTO chart_extensions_v1 (profile_id, extension_id, version, signer_key_id,
    manifest_json, payload_hash, package_blob, enabled, settings_json, installed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id, extension_id) DO UPDATE SET
    version = excluded.version, signer_key_id = excluded.signer_key_id, manifest_json = excluded.manifest_json,
    payload_hash = excluded.payload_hash, package_blob = excluded.package_blob, enabled = 0,
    installed_at_ms = excluded.installed_at_ms`).run(value.profileId, value.extensionId, value.version,
      value.signerKeyId, value.manifestJson, value.payloadHash, value.packageBlob,
      value.enabled ? 1 : 0, value.settingsJson, value.installedAtMs);
  return exists;
}

export function setChartExtensionState(profileId: string, extensionId: string, enabled: boolean,
  settingsJson: string, database: Db): boolean {
  return database.prepare(`UPDATE chart_extensions_v1 SET enabled = ?, settings_json = ?
    WHERE profile_id = ? AND extension_id = ?`).run(enabled ? 1 : 0, settingsJson,
      profileId, extensionId).changes === 1;
}

export function deleteChartExtension(profileId: string, extensionId: string, database: Db): boolean {
  return database.prepare('DELETE FROM chart_extensions_v1 WHERE profile_id = ? AND extension_id = ?')
    .run(profileId, extensionId).changes === 1;
}

export function appendChartExtensionEvent(profileId: string, extensionId: string, event: string,
  detailCode: string, atMs: number, database: Db): void {
  database.prepare(`INSERT INTO chart_extension_events_v1
    (profile_id, extension_id, event, detail_code, occurred_at_ms) VALUES (?, ?, ?, ?, ?)`)
    .run(profileId, extensionId, event, detailCode, atMs);
}
