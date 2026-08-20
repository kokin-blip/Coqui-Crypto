import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore } from '../packages/adapters/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import {
  AccountsProfileBackupService,
  AccountsProfileService,
  createProfileCredentialPresenceSource,
  createProfileOperationGate,
} from '../packages/services/src/index.js';
import {
  createFileProfileBackupStore,
  createFileProfileManifestStore,
  openDatabase,
  type CreateProfileBackupInput,
  type StoredProfileDeletionImpact,
} from '../packages/storage/src/index.js';

const PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const BACKUP_ID = '00000000-0000-4000-8000-000000000099';
const REVISION = 'a'.repeat(64);
const ZERO_IMPACT: StoredProfileDeletionImpact = Object.freeze({
  openTaxLots: 0,
  disposals: 0,
  portfolioEvidenceRecords: 0,
  paperEvidenceRecords: 0,
  researchEvidenceRecords: 0,
  alertEvidenceRecords: 0,
  importEvidenceRecords: 0,
  operationalEvidenceRecords: 0,
});
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryRoot(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function createSourceDatabase(directory: string, filename = `wallet-${PROFILE_ID}.db`): string {
  const path = join(directory, filename);
  const database = openDatabase(path);
  database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(
    'backup-marker',
    'preserved',
  );
  database.close();
  return path;
}

function backupInput(): CreateProfileBackupInput {
  return {
    backupId: BACKUP_ID,
    profileId: PROFILE_ID,
    profileName: 'Research',
    dbFilename: `wallet-${PROFILE_ID}.db`,
    createdAtMs: 50,
    sourceManifestRevision: REVISION,
    impact: ZERO_IMPACT,
    credentialKinds: ['coinbase', 'advisor_gemini'],
  };
}

describe('file profile backup store', () => {
  it('creates an atomic, checksummed SQLite artifact and independently verifies it', async () => {
    const root = temporaryRoot('coqui-profile-backup-store-');
    const backups = join(root, 'backups');
    const sourcePath = createSourceDatabase(root);
    const sourceBefore = sha256(sourcePath);
    const store = createFileProfileBackupStore(root, backups);

    const created = await store.create(backupInput());

    expect(created).toEqual({
      ok: true,
      backup: expect.objectContaining({
        formatVersion: 1,
        backupId: BACKUP_ID,
        profileId: PROFILE_ID,
        createdAtMs: 50,
        schemaVersion: 44,
        totalDurableRecords: 0,
        credentialKinds: ['advisor_gemini', 'coinbase'],
        credentialsIncluded: false,
        verified: true,
      }),
    });
    if (!created.ok) throw new Error('Expected backup creation to succeed.');
    expect(sha256(sourcePath)).toBe(sourceBefore);
    expect(Object.isFrozen(created.backup)).toBe(true);
    expect(Object.isFrozen(created.backup.credentialKinds)).toBe(true);

    const artifactPath = join(backups, created.backup.artifactName);
    const rawManifest = readFileSync(join(artifactPath, 'manifest.json'), 'utf8');
    expect(rawManifest).toContain('"credentialsIncluded": false');
    expect(rawManifest).toContain('"coinbase"');
    expect(rawManifest).not.toContain('private-key-material');
    expect(sha256(join(artifactPath, 'profile.db'))).toBe(created.backup.databaseSha256);

    const backup = new DatabaseSync(join(artifactPath, 'profile.db'), { readOnly: true });
    expect(backup.prepare('SELECT value FROM app_settings WHERE key = ?').get('backup-marker'))
      .toEqual({ value: 'preserved' });
    backup.close();
    expect(await store.verify(created.backup.artifactName, PROFILE_ID)).toEqual(created);
  });

  it('rejects traversal, conflicts, tampering, and removes failed temporary artifacts', async () => {
    const root = temporaryRoot('coqui-profile-backup-safety-');
    const backups = join(root, 'backups');
    createSourceDatabase(root);
    const store = createFileProfileBackupStore(root, backups);

    expect(await store.create({ ...backupInput(), dbFilename: '../wallet.db' })).toEqual({
      ok: false, code: 'invalid_input',
    });
    expect(existsSync(backups) ? readdirSync(backups) : []).toEqual([]);
    expect(await store.create({ ...backupInput(), dbFilename: 'missing.db' })).toEqual({
      ok: false, code: 'source_unavailable',
    });
    expect(existsSync(backups) ? readdirSync(backups) : []).toEqual([]);

    const created = await store.create(backupInput());
    expect(created.ok).toBe(true);
    expect(await store.create(backupInput())).toEqual({ ok: false, code: 'artifact_conflict' });
    if (!created.ok) throw new Error('Expected backup creation to succeed.');
    const artifactPath = join(backups, created.backup.artifactName);
    appendFileSync(join(artifactPath, 'profile.db'), 'tampered');
    expect(await store.verify(created.backup.artifactName, PROFILE_ID)).toEqual({
      ok: false, code: 'verification_failed',
    });
    expect(readdirSync(backups).some((name) => name.startsWith('.tmp-'))).toBe(false);
  });
});

function setupService() {
  const root = temporaryRoot('coqui-profile-backup-service-');
  const backups = join(root, 'backups');
  const manifestPath = join(root, 'wallet-profiles.json');
  const manifestStore = createFileProfileManifestStore(manifestPath);
  const operationGate = createProfileOperationGate();
  const profiles = new AccountsProfileService({
    clock: new FixedClock(1),
    idSource: { nextId: () => PROFILE_ID },
    manifestStore,
    operationGate,
    databaseProvisioner: {
      async provision(_profileId, dbFilename) {
        const database = openDatabase(join(root, dbFilename));
        database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(
          'backup-marker',
          'service-preserved',
        );
        database.close();
        return { ok: true };
      },
    },
  });
  profiles.initializeMain('kokintrader.db');
  const secretStore = createMemorySecretStore({
    [`coinbase-credentials:${PROFILE_ID}`]: 'private-key-material',
  });
  const backupStore = createFileProfileBackupStore(root, backups);
  const impactReader = { inspect: vi.fn(async () => ({ ok: true as const, impact: ZERO_IMPACT })) };
  const service = new AccountsProfileBackupService({
    clock: new FixedClock(50),
    idSource: { nextId: () => BACKUP_ID },
    manifestStore,
    impactReader,
    credentialPresence: createProfileCredentialPresenceSource(secretStore),
    backupStore,
    operationGate,
  });
  return {
    root, backups, manifestPath, manifestStore, operationGate, profiles,
    secretStore, backupStore, impactReader, service,
  };
}

describe('accounts profile backup service', () => {
  it('orchestrates a verified backup without exposing or changing credential values', async () => {
    const target = setupService();
    await target.profiles.create({ name: 'Research' });
    const manifestBefore = readFileSync(target.manifestPath, 'utf8');
    const sourcePath = join(target.root, `wallet-${PROFILE_ID}.db`);
    const sourceBefore = sha256(sourcePath);

    const result = await target.service.create(PROFILE_ID);

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        profileId: PROFILE_ID,
        credentialKinds: ['coinbase'],
        credentialsIncluded: false,
        verified: true,
      }),
    });
    expect(JSON.stringify(result)).not.toContain('private-key-material');
    expect(readFileSync(target.manifestPath, 'utf8')).toBe(manifestBefore);
    expect(sha256(sourcePath)).toBe(sourceBefore);
    expect(await target.secretStore.read('coinbase-credentials', PROFILE_ID)).toEqual({
      ok: true, value: 'private-key-material',
    });
    expect(target.profiles.list().ok).toBe(true);
    if (!result.ok) throw new Error('Expected backup creation to succeed.');
    expect(await target.service.verify(PROFILE_ID, result.value.artifactName)).toEqual(result);
    const manifest = readFileSync(
      join(target.backups, result.value.artifactName, 'manifest.json'),
      'utf8',
    );
    expect(manifest).not.toContain('private-key-material');
  });

  it('fails closed before artifact creation and always releases the shared gate', async () => {
    const target = setupService();
    expect(await target.service.create('main')).toEqual({
      ok: false,
      issues: [{ path: ['profileId'], code: 'profile_backup_last_profile' }],
    });
    await target.profiles.create({ name: 'Research' });
    expect(await target.service.create('main')).toEqual({
      ok: false,
      issues: [{ path: ['profileId'], code: 'profile_backup_active' }],
    });

    target.impactReader.inspect.mockRejectedValueOnce(new Error('sensitive diagnostic'));
    expect(await target.service.create(PROFILE_ID)).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_backup_impact_unavailable' }],
    });
    expect(existsSync(target.backups)).toBe(false);
    expect(target.profiles.list().ok).toBe(true);

    expect(target.operationGate.begin()).toBe(true);
    expect(await target.service.create(PROFILE_ID)).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_operation_in_progress' }],
    });
    target.operationGate.end();
    expect(await target.service.verify(PROFILE_ID, '../escape')).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_backup_invalid_artifact' }],
    });
  });
});
