import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore } from '../packages/adapters/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import {
  AccountsProfileBackupService,
  AccountsProfileDeletionService,
  AccountsProfileService,
  createProfileCredentialPresenceSource,
  createProfileCredentialRemover,
  createProfileOperationGate,
  type ProfileCredentialRemover,
  type ProfileDeletionImpactReader,
} from '../packages/services/src/index.js';
import {
  createFileProfileBackupStore,
  createFileProfileDeletionStore,
  createFileProfileManifestStore,
  openDatabase,
  type StoredProfileDeletionImpact,
  type VerifiedProfileBackup,
} from '../packages/storage/src/index.js';

const PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const BACKUP_ID = '00000000-0000-4000-8000-000000000099';
const DELETE_ID = '00000000-0000-4000-8000-000000000088';
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

function setup(credentialRemover?: ProfileCredentialRemover) {
  const root = mkdtempSync(join(tmpdir(), 'coqui-profile-delete-'));
  temporaryDirectories.push(root);
  const backups = join(root, 'backups');
  const recovery = join(root, 'recovery');
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
          'profile-marker',
          'research-profile',
        );
        database.close();
        return { ok: true };
      },
    },
  });
  profiles.initializeMain('kokintrader.db');
  const secretStore = createMemorySecretStore({
    'coinbase-credentials': 'main-secret',
    [`coinbase-credentials:${PROFILE_ID}`]: 'profile-secret',
  });
  const credentialPresence = createProfileCredentialPresenceSource(secretStore);
  let impact: StoredProfileDeletionImpact = ZERO_IMPACT;
  const impactReader: ProfileDeletionImpactReader = {
    inspect: vi.fn(async () => ({ ok: true, impact })),
  };
  const backupStore = createFileProfileBackupStore(root, backups);
  const deletionStore = createFileProfileDeletionStore(root, recovery, manifestStore);
  const backupService = new AccountsProfileBackupService({
    clock: new FixedClock(50),
    idSource: { nextId: () => BACKUP_ID },
    manifestStore,
    impactReader,
    credentialPresence,
    backupStore,
    operationGate,
  });
  const deletionService = new AccountsProfileDeletionService({
    clock: new FixedClock(60),
    idSource: { nextId: () => DELETE_ID },
    manifestStore,
    impactReader,
    credentialPresence,
    credentialRemover: credentialRemover ?? createProfileCredentialRemover(secretStore),
    backupStore,
    deletionStore,
    operationGate,
  });
  return {
    root, backups, recovery, manifestPath, manifestStore, operationGate, profiles,
    secretStore, credentialPresence, impactReader, backupStore, deletionStore,
    backupService, deletionService,
    setImpact(value: StoredProfileDeletionImpact) { impact = value; },
  };
}

async function createProfileAndBackup(target: ReturnType<typeof setup>): Promise<VerifiedProfileBackup> {
  const created = await target.profiles.create({ name: 'Research' });
  expect(created.ok).toBe(true);
  const backup = await target.backupService.create(PROFILE_ID);
  if (!backup.ok) throw new Error('Expected profile backup to succeed.');
  return backup.value;
}

function deletionInput(backup: VerifiedProfileBackup) {
  return {
    profileId: PROFILE_ID,
    backupArtifactName: backup.artifactName,
    confirmation: {
      action: 'delete_profile_permanently' as const,
      profileId: PROFILE_ID,
      backupId: backup.backupId,
      acknowledgeCredentialRemoval: true as const,
    },
  };
}

describe('confirmed profile deletion', { timeout: 20_000 }, () => {
  it('commits manifest removal, deletes only the target database and credentials, and retains the backup', async () => {
    const target = setup();
    const backup = await createProfileAndBackup(target);
    const sourcePath = join(target.root, `wallet-${PROFILE_ID}.db`);
    const backupPath = join(target.backups, backup.artifactName, 'profile.db');
    const backupBefore = readFileSync(backupPath);

    const result = await target.deletionService.delete(deletionInput(backup));

    expect(result).toEqual({
      ok: true,
      value: {
        profileId: PROFILE_ID,
        backupId: BACKUP_ID,
        backupArtifactName: backup.artifactName,
        recoveryId: DELETE_ID,
        deleted: true,
        cleanupStatus: 'complete',
        databaseCleanupPending: false,
        credentialCleanupPending: [],
        journalCleanupPending: false,
      },
    });
    expect(existsSync(sourcePath)).toBe(false);
    expect(readFileSync(backupPath)).toEqual(backupBefore);
    expect(await target.backupStore.verify(backup.artifactName, PROFILE_ID)).toEqual({
      ok: true, backup,
    });
    expect(target.profiles.list()).toEqual({
      ok: true,
      value: [expect.objectContaining({ id: 'main', isActive: true, order: 0 })],
    });
    expect(await target.secretStore.read('coinbase-credentials', PROFILE_ID)).toEqual({
      ok: true, value: null,
    });
    expect(await target.secretStore.read('coinbase-credentials', 'main')).toEqual({
      ok: true, value: 'main-secret',
    });
    expect(existsSync(target.recovery) ? readdirSync(target.recovery) : []).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.credentialCleanupPending)).toBe(true);
  });

  it('rejects missing confirmation, tampered backups, and stale profile revisions without mutation', async () => {
    const target = setup();
    const backup = await createProfileAndBackup(target);
    const sourcePath = join(target.root, `wallet-${PROFILE_ID}.db`);
    const manifestBefore = readFileSync(target.manifestPath, 'utf8');

    expect(await target.deletionService.delete({
      ...deletionInput(backup),
      confirmation: { ...deletionInput(backup).confirmation, acknowledgeCredentialRemoval: false as true },
    })).toEqual({
      ok: false,
      issues: [{ path: ['confirmation'], code: 'profile_delete_confirmation_required' }],
    });
    expect(readFileSync(target.manifestPath, 'utf8')).toBe(manifestBefore);
    expect(existsSync(sourcePath)).toBe(true);

    appendFileSync(join(target.backups, backup.artifactName, 'profile.db'), 'tampered');
    expect(await target.deletionService.delete(deletionInput(backup))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_backup_verification_failed' }],
    });
    expect(readFileSync(target.manifestPath, 'utf8')).toBe(manifestBefore);
    expect(existsSync(sourcePath)).toBe(true);

    const fresh = setup();
    const freshBackup = await createProfileAndBackup(fresh);
    expect(fresh.profiles.update({ id: PROFILE_ID, name: 'Renamed' }).ok).toBe(true);
    const changedManifest = readFileSync(fresh.manifestPath, 'utf8');
    expect(await fresh.deletionService.delete(deletionInput(freshBackup))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_delete_backup_stale' }],
    });
    expect(readFileSync(fresh.manifestPath, 'utf8')).toBe(changedManifest);
    expect(existsSync(join(fresh.root, `wallet-${PROFILE_ID}.db`))).toBe(true);
    expect(await fresh.secretStore.read('coinbase-credentials', PROFILE_ID)).toEqual({
      ok: true, value: 'profile-secret',
    });
  });

  it('requires a new backup when evidence or credential-category inspection changed', async () => {
    const target = setup();
    const backup = await createProfileAndBackup(target);
    target.setImpact({ ...ZERO_IMPACT, operationalEvidenceRecords: 1 });
    expect(await target.deletionService.delete(deletionInput(backup))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_delete_backup_stale' }],
    });
    expect(target.profiles.list()).toEqual({
      ok: true,
      value: expect.arrayContaining([expect.objectContaining({ id: PROFILE_ID })]),
    });
    expect(existsSync(target.recovery) ? readdirSync(target.recovery) : []).toEqual([]);

    target.setImpact(ZERO_IMPACT);
    expect(await target.secretStore.write('gemini-api-key', 'new-advisor-secret', PROFILE_ID))
      .toEqual({ ok: true });
    expect(await target.deletionService.delete(deletionInput(backup))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_delete_backup_stale' }],
    });
    expect(await target.secretStore.read('gemini-api-key', PROFILE_ID)).toEqual({
      ok: true, value: 'new-advisor-secret',
    });
  });

  it('reports committed cleanup as pending and resumes idempotently after keychain recovery', async () => {
    const failingRemover: ProfileCredentialRemover = {
      remove: vi.fn(async () => ({ ok: false })),
    };
    const target = setup(failingRemover);
    const backup = await createProfileAndBackup(target);

    const first = await target.deletionService.delete(deletionInput(backup));
    expect(first).toEqual({
      ok: true,
      value: expect.objectContaining({
        deleted: true,
        cleanupStatus: 'pending',
        databaseCleanupPending: false,
        credentialCleanupPending: ['coinbase'],
        journalCleanupPending: true,
      }),
    });
    expect(target.profiles.list()).toEqual({
      ok: true,
      value: [expect.objectContaining({ id: 'main' })],
    });
    expect(await target.secretStore.read('coinbase-credentials', PROFILE_ID)).toEqual({
      ok: true, value: 'profile-secret',
    });
    expect(readdirSync(target.recovery)).toHaveLength(1);

    const resumed = new AccountsProfileDeletionService({
      clock: new FixedClock(70),
      idSource: { nextId: () => '00000000-0000-4000-8000-000000000077' },
      manifestStore: target.manifestStore,
      impactReader: target.impactReader,
      credentialPresence: target.credentialPresence,
      credentialRemover: createProfileCredentialRemover(target.secretStore),
      backupStore: target.backupStore,
      deletionStore: target.deletionStore,
      operationGate: target.operationGate,
    });
    expect(await resumed.resumePending()).toEqual({
      ok: true,
      value: [expect.objectContaining({
        recoveryId: DELETE_ID,
        cleanupStatus: 'complete',
        credentialCleanupPending: [],
        journalCleanupPending: false,
      })],
    });
    expect(await target.secretStore.read('coinbase-credentials', PROFILE_ID)).toEqual({
      ok: true, value: null,
    });
    expect(readdirSync(target.recovery)).toEqual([]);
    expect(await resumed.resumePending()).toEqual({ ok: true, value: [] });
  });

  it('fails closed on a corrupt recovery journal and does not touch another profile', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Research' });
    expect(await target.deletionStore.pending()).toEqual({ ok: true, value: [] });
    writeFileSync(join(target.recovery, `profile-deletion-${DELETE_ID}.json`), '{bad json');
    expect(await target.deletionService.resumePending()).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_delete_recovery_corrupt' }],
    });
    expect(target.profiles.list()).toEqual({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({ id: 'main' }),
        expect.objectContaining({ id: PROFILE_ID }),
      ]),
    });
    expect(existsSync(join(target.root, `wallet-${PROFILE_ID}.db`))).toBe(true);
    expect(await target.secretStore.read('coinbase-credentials', PROFILE_ID)).toEqual({
      ok: true, value: 'profile-secret',
    });
  });

  it('serializes with profile operations and preserves the manifest when the source is unavailable', async () => {
    const target = setup();
    const backup = await createProfileAndBackup(target);
    expect(target.operationGate.begin()).toBe(true);
    expect(await target.deletionService.delete(deletionInput(backup))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_operation_in_progress' }],
    });
    target.operationGate.end();

    rmSync(join(target.root, `wallet-${PROFILE_ID}.db`));
    const manifestBefore = readFileSync(target.manifestPath, 'utf8');
    expect(await target.deletionService.delete(deletionInput(backup))).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_delete_source_unavailable' }],
    });
    expect(readFileSync(target.manifestPath, 'utf8')).toBe(manifestBefore);
    expect(await target.secretStore.read('coinbase-credentials', PROFILE_ID)).toEqual({
      ok: true, value: 'profile-secret',
    });
    expect(existsSync(target.recovery) ? readdirSync(target.recovery) : []).toEqual([]);
  });
});
