import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../packages/core/src/index.js';
import {
  AccountsProfileService,
  type CreateAccountProfileInput,
  type PreparedProfileContext,
  type ProfileContextManager,
  type ProfileDatabaseProvisioner,
  type ProfileIdSource,
} from '../packages/services/src/index.js';
import {
  createFileProfileManifestStore,
  openDatabase,
  type ProfileManifestStore,
} from '../packages/storage/src/index.js';

const ID_A = '00000000-0000-4000-8000-000000000001';
const ID_B = '00000000-0000-4000-8000-000000000002';
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'coqui-profiles-'));
  temporaryDirectories.push(directory);
  const manifestPath = join(directory, 'wallet-profiles.json');
  const provisioner: ProfileDatabaseProvisioner = {
    async provision(_profileId, dbFilename) {
      const database = openDatabase(join(directory, dbFilename));
      database.close();
      return { ok: true };
    },
  };
  return {
    directory,
    manifestPath,
    manifestStore: createFileProfileManifestStore(manifestPath),
    provisioner,
  };
}

function ids(...values: string[]): ProfileIdSource {
  return { nextId: vi.fn(() => values.shift() ?? ID_B) };
}

describe('accounts profile service', () => {
  it('initializes and reads a predecessor-compatible secret-free main profile', () => {
    const target = fixture();
    const service = new AccountsProfileService({
      clock: new FixedClock(100), idSource: ids(),
      manifestStore: target.manifestStore, databaseProvisioner: target.provisioner,
    });

    const initialized = service.initializeMain('kokintrader.db');
    expect(initialized).toEqual({
      ok: true,
      value: {
        id: 'main', name: 'Main Wallet', color: '#60a5fa', icon: 'wallet',
        isActive: true, createdAtMs: 100, lastOpenedAtMs: 100, order: 0,
      },
    });
    const raw = readFileSync(target.manifestPath, 'utf8');
    expect(raw).toContain('"activeWalletId": "main"');
    expect(raw).toContain('"wallets"');
    expect(raw).not.toContain('apiKey');
    expect(service.list()).toEqual({ ok: true, value: [initialized.ok && initialized.value] });
    expect(service.active()).toEqual(initialized);
    expect(Object.isFrozen(initialized)).toBe(true);
    expect(Object.isFrozen(initialized.ok && initialized.value)).toBe(true);
  });

  it('provisions an isolated migrated database before publishing a new inactive profile', async () => {
    const target = fixture();
    const clock = new FixedClock(200);
    const idSource = ids(ID_A);
    const provision = vi.spyOn(target.provisioner, 'provision');
    const service = new AccountsProfileService({
      clock, idSource, manifestStore: target.manifestStore,
      databaseProvisioner: target.provisioner,
    });
    service.initializeMain('kokintrader.db');

    clock.set(250);
    const created = await service.create({ name: '  Research   Wallet  ' });
    expect(created).toEqual({
      ok: true,
      value: {
        id: ID_A, name: 'Research Wallet', color: '#34d399', icon: 'wallet',
        isActive: false, createdAtMs: 250, lastOpenedAtMs: 250, order: 1,
      },
    });
    expect(provision).toHaveBeenCalledWith(ID_A, `wallet-${ID_A}.db`);
    const dbPath = join(target.directory, `wallet-${ID_A}.db`);
    expect(existsSync(dbPath)).toBe(true);
    const database = openDatabase(dbPath);
    expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 46 });
    database.close();
    expect(service.active()).toEqual({
      ok: true,
      value: expect.objectContaining({ id: 'main', isActive: true }),
    });
    expect(service.list()).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ id: 'main', order: 0 }),
        expect.objectContaining({ id: ID_A, order: 1 }),
      ],
    });
  });

  it('validates all create fields before reading state, time, ids, or provisioning', async () => {
    const read = vi.fn();
    const manifestStore: ProfileManifestStore = {
      read,
      replace: vi.fn(),
    };
    const nowMs = vi.fn(() => 1);
    const idSource = ids(ID_A);
    const databaseProvisioner: ProfileDatabaseProvisioner = { provision: vi.fn() };
    const service = new AccountsProfileService({
      clock: { nowMs }, idSource, manifestStore, databaseProvisioner,
    });
    const invalid = {
      name: '', color: '#ffffff', icon: 'robot', diagnostic: 'secret-bearing value',
    } as unknown as CreateAccountProfileInput;
    const result = await service.create(invalid);
    expect(result).toEqual({
      ok: false,
      issues: [
        { path: [], code: 'unknown_field' },
        { path: ['name'], code: 'invalid_name' },
        { path: ['color'], code: 'invalid_color' },
        { path: ['icon'], code: 'invalid_icon' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-bearing');
    expect(read).not.toHaveBeenCalled();
    expect(nowMs).not.toHaveBeenCalled();
    expect(idSource.nextId).not.toHaveBeenCalled();
    expect(databaseProvisioner.provision).not.toHaveBeenCalled();
  });

  it('updates only display metadata and preserves predecessor identity fingerprints', () => {
    const target = fixture();
    const fingerprint = 'a'.repeat(64);
    writeFileSync(target.manifestPath, JSON.stringify({
      version: 1,
      activeWalletId: 'main',
      wallets: [{
        id: 'main', name: 'Main Wallet', color: '#60a5fa', icon: 'wallet',
        dbFilename: 'kokintrader.db', createdAt: 1, lastOpenedAt: 2, order: 0,
        coinbaseKeyFingerprint: fingerprint,
      }],
    }));
    const nowMs = vi.fn(() => 999);
    const service = new AccountsProfileService({
      clock: { nowMs }, idSource: ids(), manifestStore: target.manifestStore,
      databaseProvisioner: target.provisioner,
    });

    const updated = service.update({ name: '  Long   Term ', id: 'main', icon: 'shield' });
    expect(updated).toEqual({
      ok: true,
      value: expect.objectContaining({
        id: 'main', name: 'Long Term', icon: 'shield', isActive: true,
        createdAtMs: 1, lastOpenedAtMs: 2,
      }),
    });
    const stored = JSON.parse(readFileSync(target.manifestPath, 'utf8')) as {
      wallets: Array<Record<string, unknown>>;
    };
    expect(stored.wallets[0]?.['coinbaseKeyFingerprint']).toBe(fingerprint);
    expect(stored.wallets[0]).not.toHaveProperty('apiKey');
    expect(nowMs).not.toHaveBeenCalled();
  });

  it('requires an exact reorder permutation and preserves state after failure', async () => {
    const target = fixture();
    const service = new AccountsProfileService({
      clock: new FixedClock(10), idSource: ids(ID_A, ID_B),
      manifestStore: target.manifestStore, databaseProvisioner: target.provisioner,
    });
    service.initializeMain('kokintrader.db');
    await service.create({ name: 'A' });
    await service.create({ name: 'B' });
    const before = readFileSync(target.manifestPath, 'utf8');

    expect(service.reorder([ID_A, ID_A, 'main'])).toEqual({
      ok: false,
      issues: [{ path: ['orderedIds'], code: 'invalid_permutation' }],
    });
    expect(readFileSync(target.manifestPath, 'utf8')).toBe(before);
    const reordered = service.reorder([ID_B, 'main', ID_A]);
    expect(reordered).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ id: ID_B, order: 0 }),
        expect.objectContaining({ id: 'main', order: 1, isActive: true }),
        expect.objectContaining({ id: ID_A, order: 2 }),
      ],
    });
    expect(service.active()).toEqual({
      ok: true, value: expect.objectContaining({ id: 'main', order: 1 }),
    });
  });

  it('does not publish a profile when isolated database provisioning fails', async () => {
    const target = fixture();
    const service = new AccountsProfileService({
      clock: new FixedClock(10), idSource: ids(ID_A),
      manifestStore: target.manifestStore,
      databaseProvisioner: { provision: vi.fn(async () => ({ ok: false })) },
    });
    service.initializeMain('kokintrader.db');
    const before = readFileSync(target.manifestPath, 'utf8');
    expect(await service.create({ name: 'Unavailable' })).toEqual({
      ok: false,
      issues: [{ path: [], code: 'database_provision_failed' }],
    });
    expect(readFileSync(target.manifestPath, 'utf8')).toBe(before);
  });

  it('fails closed on corrupt manifests without overwriting or consuming time', () => {
    const target = fixture();
    const corrupt = '{"version":1,"activeWalletId":"missing","wallets":[]}';
    writeFileSync(target.manifestPath, corrupt);
    const nowMs = vi.fn(() => 10);
    const service = new AccountsProfileService({
      clock: { nowMs }, idSource: ids(), manifestStore: target.manifestStore,
      databaseProvisioner: target.provisioner,
    });
    expect(service.initializeMain('kokintrader.db')).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_store_corrupt' }],
    });
    expect(service.list()).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_store_corrupt' }],
    });
    expect(readFileSync(target.manifestPath, 'utf8')).toBe(corrupt);
    expect(nowMs).not.toHaveBeenCalled();
  });

  it('publishes the durable selection before atomically committing a prepared context', async () => {
    const target = fixture();
    let publishedActive: string | null = null;
    const abort = vi.fn(async () => {});
    const commit = vi.fn(async () => {
      const raw = JSON.parse(readFileSync(target.manifestPath, 'utf8')) as {
        activeWalletId: string;
      };
      publishedActive = raw.activeWalletId;
      return { ok: true };
    });
    const prepare = vi.fn(async () => ({
      ok: true as const,
      context: { commit, abort },
    }));
    const clock = new FixedClock(10);
    const service = new AccountsProfileService({
      clock, idSource: ids(ID_A), manifestStore: target.manifestStore,
      databaseProvisioner: target.provisioner, contextManager: { prepare },
    });
    service.initializeMain('kokintrader.db');
    await service.create({ name: 'Research' });

    clock.set(50);
    const switched = await service.switchActive(ID_A);
    expect(switched).toEqual({
      ok: true,
      value: expect.objectContaining({
        id: ID_A, name: 'Research', isActive: true, lastOpenedAtMs: 50,
      }),
    });
    expect(prepare).toHaveBeenCalledWith(ID_A, `wallet-${ID_A}.db`);
    expect(publishedActive).toBe(ID_A);
    expect(commit).toHaveBeenCalledOnce();
    expect(abort).not.toHaveBeenCalled();
    expect(service.active()).toEqual(switched);
    expect(JSON.stringify(switched)).not.toContain(`wallet-${ID_A}.db`);

    expect(await service.switchActive(ID_A)).toEqual(switched);
    expect(prepare).toHaveBeenCalledOnce();
  });

  it('rejects invalid and missing switch targets before time or context preparation', async () => {
    const target = fixture();
    const nowMs = vi.fn(() => 10);
    const prepare = vi.fn();
    const service = new AccountsProfileService({
      clock: { nowMs }, idSource: ids(), manifestStore: target.manifestStore,
      databaseProvisioner: target.provisioner, contextManager: { prepare },
    });
    service.initializeMain('kokintrader.db');
    nowMs.mockClear();

    expect(await service.switchActive('bad/profile')).toEqual({
      ok: false, issues: [{ path: ['profileId'], code: 'invalid_profile_id' }],
    });
    expect(await service.switchActive(ID_A)).toEqual({
      ok: false, issues: [{ path: ['profileId'], code: 'profile_not_found' }],
    });
    expect(nowMs).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('preserves the old selection when preparation or safe commit fails', async () => {
    const target = fixture();
    const abort = vi.fn(async () => {});
    let context: PreparedProfileContext | null = null;
    const contextManager: ProfileContextManager = {
      async prepare() {
        return context === null ? { ok: false } : { ok: true, context };
      },
    };
    const service = new AccountsProfileService({
      clock: new FixedClock(10), idSource: ids(ID_A), manifestStore: target.manifestStore,
      databaseProvisioner: target.provisioner, contextManager,
    });
    service.initializeMain('kokintrader.db');
    await service.create({ name: 'Research' });
    const before = target.manifestStore.read();

    expect(await service.switchActive(ID_A)).toEqual({
      ok: false, issues: [{ path: [], code: 'context_prepare_failed' }],
    });
    expect(service.active()).toEqual({
      ok: true, value: expect.objectContaining({ id: 'main', isActive: true }),
    });

    context = { commit: async () => ({ ok: false }), abort };
    expect(await service.switchActive(ID_A)).toEqual({
      ok: false, issues: [{ path: [], code: 'context_commit_failed' }],
    });
    expect(abort).toHaveBeenCalledOnce();
    expect(service.active()).toEqual({
      ok: true, value: expect.objectContaining({ id: 'main', isActive: true }),
    });
    const after = target.manifestStore.read();
    expect(after.ok && after.value?.manifest).toEqual(before.ok && before.value?.manifest);
  });

  it('serializes profile operations while a context switch is in flight', async () => {
    const target = fixture();
    let resolvePreparation!: (value: {
      ok: true;
      context: PreparedProfileContext;
    }) => void;
    const pending = new Promise<{
      ok: true;
      context: PreparedProfileContext;
    }>((resolve) => { resolvePreparation = resolve; });
    const service = new AccountsProfileService({
      clock: new FixedClock(10), idSource: ids(ID_A), manifestStore: target.manifestStore,
      databaseProvisioner: target.provisioner,
      contextManager: { prepare: async () => await pending },
    });
    service.initializeMain('kokintrader.db');
    await service.create({ name: 'Research' });

    const switching = service.switchActive(ID_A);
    await Promise.resolve();
    expect(service.list()).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_operation_in_progress' }],
    });
    expect(service.update({ id: 'main', name: 'Blocked Rename' })).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_operation_in_progress' }],
    });
    resolvePreparation({
      ok: true,
      context: { commit: async () => ({ ok: true }), abort: async () => {} },
    });
    await expect(switching).resolves.toEqual({
      ok: true, value: expect.objectContaining({ id: ID_A, isActive: true }),
    });
    expect(service.list()).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ id: 'main', name: 'Main Wallet', isActive: false }),
        expect.objectContaining({ id: ID_A, isActive: true }),
      ],
    });
  });

  it('keeps the durable target and requires recovery after an ambiguous thrown commit', async () => {
    const target = fixture();
    const diagnostic = 'secret-bearing context failure';
    const abort = vi.fn(async () => {});
    const service = new AccountsProfileService({
      clock: new FixedClock(20), idSource: ids(ID_A), manifestStore: target.manifestStore,
      databaseProvisioner: target.provisioner,
      contextManager: {
        prepare: async () => ({
          ok: true,
          context: {
            commit: async () => { throw new Error(diagnostic); },
            abort,
          },
        }),
      },
    });
    service.initializeMain('kokintrader.db');
    await service.create({ name: 'Recovery Target' });

    const result = await service.switchActive(ID_A);
    expect(result).toEqual({
      ok: false, issues: [{ path: [], code: 'context_recovery_required' }],
    });
    expect(JSON.stringify(result)).not.toContain(diagnostic);
    expect(abort).not.toHaveBeenCalled();
    expect(service.active()).toEqual({
      ok: true,
      value: expect.objectContaining({ id: ID_A, isActive: true, lastOpenedAtMs: 20 }),
    });
  });
});
