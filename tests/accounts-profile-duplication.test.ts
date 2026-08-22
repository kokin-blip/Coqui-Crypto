import { createHash } from 'node:crypto';
import {
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
  AccountsProfileDuplicationService,
  AccountsProfileService,
  createProfileOperationGate,
} from '../packages/services/src/index.js';
import {
  createFileProfileDatabaseDuplicator,
  createFileProfileManifestStore,
  openDatabase,
  type ProfileDatabaseDuplicator,
  type ProfileManifestStore,
} from '../packages/storage/src/index.js';

const TARGET_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(root);
  return root;
}

function hash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function createSource(root: string, profileId = 'main'): string {
  const path = join(root, 'kokintrader.db');
  const database = openDatabase(path);
  database.exec(`
    CREATE TABLE future_profile_state (
      profile_id TEXT PRIMARY KEY,
      state TEXT NOT NULL
    );
  `);
  database.prepare('INSERT INTO future_profile_state (profile_id, state) VALUES (?, ?)')
    .run(profileId, 'future-preserved');
  database.prepare(`
    INSERT INTO advisor_profile_configs_v1 (profile_id, model_policy_id, updated_at)
    VALUES (?, 'advisor_balanced_v1', 10)
  `).run(profileId);
  database.prepare(`
    INSERT INTO wallet_risk_profiles (profile_id, version, profile_json, updated_at)
    VALUES (?, 1, '{}', 10)
  `).run(profileId);
  database.prepare(`
    INSERT INTO wallet_schedule_lease (
      profile_id, owner_id, leased_until, next_run_at, last_run_at, state, error,
      cadence_ms, utc_offset_ms, enabled
    ) VALUES (?, 'source-owner', 100, 200, 50, 'running', NULL, 86400000, 0, 1)
  `).run(profileId);
  database.prepare(`
    INSERT INTO coinbase_import_jobs (
      id, profile_id, status, cost_basis_method, started_at, completed_at,
      discrepancy_count, error
    ) VALUES ('pending-import', ?, 'staging', 'FIFO', 10, NULL, 0, NULL)
  `).run(profileId);
  database.prepare(`
    INSERT INTO coinbase_import_stage_lots (job_id, row_id, row_json)
    VALUES ('pending-import', 'row-1', '{}')
  `).run();
  database.prepare(`INSERT INTO coinbase_sync_runs_v2 (
    id, origin_profile_id, requested_at_ms, received_at_ms, account_page_count,
    fill_page_count, account_row_count, fill_row_count, dataset_hash
  ) VALUES (?, ?, 5, 6, 1, 1, 0, 0, ?)`)
    .run('d'.repeat(64), profileId, 'e'.repeat(64));
  database.prepare(`INSERT INTO canonical_instruments (
    venue, product_id, product_type, symbol, name, base_asset, quote_asset,
    created_at, updated_at
  ) VALUES ('coinbase', 'BTC-USD', 'spot', 'BTC', 'Bitcoin', 'BTC', 'USD', 1, 1)`).run();
  database.prepare(`INSERT INTO display_universe_items_v1 (
    profile_id, position, venue, product_id, product_type, selected_at
  ) VALUES (?, 0, 'coinbase', 'BTC-USD', 'spot', 5)`).run(profileId);
  database.prepare(`INSERT INTO display_universe_events_v1 (
    id, origin_profile_id, recorded_at_ms, selection_json, selection_hash
  ) VALUES ('display-event', ?, 5, '[]', ?)`).run(profileId, 'f'.repeat(64));
  database.prepare(`INSERT INTO account_preferences_v1 (
    profile_id, theme, density, motion, language, updated_at_ms
  ) VALUES (?, 'dark', 'compact', 'none', 'es', 5)`).run(profileId);
  database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
    .run('display-density', 'compact');
  for (const key of [
    'credentials.coinbase.v2', 'credentials.coinbase.v3.status',
    'credentials.gemini.v2', 'coinbase.last_sync_at',
  ]) {
    database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(key, 'configured');
  }
  database.close();
  return path;
}

describe('profile database duplication storage', { timeout: 20_000 }, () => {
  it('clones a consistent database and rewrites every discovered profile identity', async () => {
    const root = temporaryRoot('coqui-duplicate-store-');
    const sourcePath = createSource(root);
    const before = hash(sourcePath);
    const duplicator = createFileProfileDatabaseDuplicator(root);

    const result = await duplicator.duplicate({
      sourceProfileId: 'main',
      sourceDbFilename: 'kokintrader.db',
      targetProfileId: TARGET_ID,
      targetDbFilename: `wallet-${TARGET_ID}.db`,
    });

    expect(result).toEqual({
      ok: true,
      evidence: expect.objectContaining({
        schemaVersion: 46,
        profileScopedTableCount: 32,
        rewrittenRowCount: 7,
        excludedTransientRowCount: 3,
        clearedCredentialMetadataCount: 4,
        integrityVerified: true,
      }),
    });
    expect(hash(sourcePath)).toBe(before);
    const targetPath = join(root, `wallet-${TARGET_ID}.db`);
    if (!result.ok) throw new Error('Expected duplication to succeed.');
    expect(hash(targetPath)).toBe(result.evidence.databaseSha256);
    expect(Object.isFrozen(result.evidence)).toBe(true);

    const source = new DatabaseSync(sourcePath, { readOnly: true });
    const target = new DatabaseSync(targetPath, { readOnly: true });
    for (const table of [
      'future_profile_state', 'advisor_profile_configs_v1', 'wallet_risk_profiles',
    ]) {
      expect(source.prepare(`SELECT profile_id FROM ${table}`).get()).toEqual({ profile_id: 'main' });
      expect(target.prepare(`SELECT profile_id FROM ${table}`).get()).toEqual({ profile_id: TARGET_ID });
    }
    expect(target.prepare('SELECT value FROM app_settings WHERE key = ?').get('display-density'))
      .toEqual({ value: 'compact' });
    expect(target.prepare(`
      SELECT COUNT(*) AS count FROM app_settings WHERE key LIKE 'credentials.%'
        OR key = 'coinbase.last_sync_at'
    `).get()).toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM wallet_schedule_lease').get())
      .toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM coinbase_import_jobs').get())
      .toEqual({ count: 0 });
    expect(target.prepare('SELECT COUNT(*) AS count FROM coinbase_import_stage_lots').get())
      .toEqual({ count: 0 });
    expect(target.prepare('SELECT origin_profile_id FROM coinbase_sync_runs_v2').get())
      .toEqual({ origin_profile_id: 'main' });
    expect(target.prepare('SELECT profile_id FROM display_universe_items_v1').get())
      .toEqual({ profile_id: TARGET_ID });
    expect(target.prepare('SELECT origin_profile_id FROM display_universe_events_v1').get())
      .toEqual({ origin_profile_id: 'main' });
    expect(target.prepare('SELECT profile_id, theme FROM account_preferences_v1').get())
      .toEqual({ profile_id: TARGET_ID, theme: 'dark' });
    expect(source.prepare('SELECT COUNT(*) AS count FROM wallet_schedule_lease').get())
      .toEqual({ count: 1 });
    expect(source.prepare('SELECT COUNT(*) AS count FROM coinbase_import_jobs').get())
      .toEqual({ count: 1 });
    expect(target.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    source.close();
    target.close();
    expect(readdirSync(root).some((name) => name.startsWith('.tmp-duplicate-'))).toBe(false);
  });

  it('rejects cross-profile contamination and never publishes a partial clone', async () => {
    const root = temporaryRoot('coqui-duplicate-identity-');
    const sourcePath = createSource(root, OTHER_ID);
    const before = hash(sourcePath);
    const duplicator = createFileProfileDatabaseDuplicator(root);
    expect(await duplicator.duplicate({
      sourceProfileId: 'main',
      sourceDbFilename: 'kokintrader.db',
      targetProfileId: TARGET_ID,
      targetDbFilename: `wallet-${TARGET_ID}.db`,
    })).toEqual({ ok: false, code: 'foreign_profile_identity' });
    expect(hash(sourcePath)).toBe(before);
    expect(existsSync(join(root, `wallet-${TARGET_ID}.db`))).toBe(false);
    expect(readdirSync(root).some((name) => name.startsWith('.tmp-duplicate-'))).toBe(false);
  });

  it('rejects invalid destinations and existing target files without overwriting', async () => {
    const root = temporaryRoot('coqui-duplicate-conflict-');
    createSource(root);
    const targetPath = join(root, `wallet-${TARGET_ID}.db`);
    const existing = openDatabase(targetPath);
    existing.close();
    const before = hash(targetPath);
    const duplicator = createFileProfileDatabaseDuplicator(root);
    expect(await duplicator.duplicate({
      sourceProfileId: 'main', sourceDbFilename: 'kokintrader.db',
      targetProfileId: TARGET_ID, targetDbFilename: `wallet-${TARGET_ID}.db`,
    })).toEqual({ ok: false, code: 'destination_conflict' });
    expect(await duplicator.duplicate({
      sourceProfileId: 'main', sourceDbFilename: '../escape.db',
      targetProfileId: TARGET_ID, targetDbFilename: `wallet-${TARGET_ID}.db`,
    })).toEqual({ ok: false, code: 'invalid_input' });
    expect(hash(targetPath)).toBe(before);
  });
});

function serviceSetup(manifestOverride?: ProfileManifestStore) {
  const root = temporaryRoot('coqui-duplicate-service-');
  createSource(root);
  const manifestPath = join(root, 'wallet-profiles.json');
  const manifestStore = createFileProfileManifestStore(manifestPath);
  const gate = createProfileOperationGate();
  const profiles = new AccountsProfileService({
    clock: new FixedClock(1), idSource: { nextId: () => OTHER_ID }, manifestStore,
    operationGate: gate,
    databaseProvisioner: { provision: async () => ({ ok: true }) },
  });
  profiles.initializeMain('kokintrader.db');
  const loaded = manifestStore.read();
  if (!loaded.ok || !loaded.value) throw new Error('Expected manifest initialization.');
  const fingerprinted = {
    ...loaded.value.manifest,
    profiles: loaded.value.manifest.profiles.map((profile) => ({
      ...profile,
      coinbaseKeyFingerprint: 'a'.repeat(64),
      coinbasePortfolioFingerprint: 'b'.repeat(64),
    })),
  };
  expect(manifestStore.replace(loaded.value.revision, fingerprinted).ok).toBe(true);
  const duplicator = createFileProfileDatabaseDuplicator(root);
  const service = new AccountsProfileDuplicationService({
    clock: new FixedClock(50), idSource: { nextId: () => TARGET_ID },
    manifestStore: manifestOverride ?? manifestStore, databaseDuplicator: duplicator,
    operationGate: gate,
  });
  return { root, manifestPath, manifestStore, gate, profiles, duplicator, service };
}

describe('accounts profile duplication service', { timeout: 20_000 }, () => {
  it('publishes a new inactive profile while copying no credentials or provider fingerprints', async () => {
    const target = serviceSetup();
    const secrets = createMemorySecretStore({
      'coinbase-credentials': 'source-secret',
      'gemini-api-key': 'source-advisor-secret',
    });

    const result = await target.service.duplicate({
      sourceProfileId: 'main', name: ' Research Copy ', color: '#34d399', icon: 'rocket',
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        sourceProfileId: 'main',
        profile: {
          id: TARGET_ID,
          name: 'Research Copy',
          color: '#34d399',
          icon: 'rocket',
          isActive: false,
          createdAtMs: 50,
          lastOpenedAtMs: 50,
          order: 1,
        },
        schemaVersion: 46,
        profileScopedTableCount: 32,
        rewrittenRowCount: 7,
        excludedTransientRowCount: 3,
        clearedCredentialMetadataCount: 4,
        credentialsCopied: false,
        providerFingerprintsCopied: false,
      }),
    });
    const manifest = target.manifestStore.read();
    if (!manifest.ok || !manifest.value) throw new Error('Expected duplicated manifest.');
    const source = manifest.value.manifest.profiles.find((profile) => profile.id === 'main');
    const duplicate = manifest.value.manifest.profiles.find((profile) => profile.id === TARGET_ID);
    expect(source).toEqual(expect.objectContaining({
      coinbaseKeyFingerprint: 'a'.repeat(64),
      coinbasePortfolioFingerprint: 'b'.repeat(64),
    }));
    expect(duplicate).not.toHaveProperty('coinbaseKeyFingerprint');
    expect(duplicate).not.toHaveProperty('coinbasePortfolioFingerprint');
    expect(manifest.value.manifest.activeProfileId).toBe('main');
    expect(await secrets.read('coinbase-credentials', 'main')).toEqual({
      ok: true, value: 'source-secret',
    });
    expect(await secrets.read('coinbase-credentials', TARGET_ID)).toEqual({ ok: true, value: null });
    expect(await secrets.read('gemini-api-key', TARGET_ID)).toEqual({ ok: true, value: null });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.profile)).toBe(true);
  });

  it('removes the cloned database when manifest publication conflicts', async () => {
    const initial = serviceSetup();
    const conflictingStore: ProfileManifestStore = {
      read: () => initial.manifestStore.read(),
      replace: () => ({ ok: false, code: 'conflict' }),
    };
    const service = new AccountsProfileDuplicationService({
      clock: new FixedClock(50), idSource: { nextId: () => TARGET_ID },
      manifestStore: conflictingStore, databaseDuplicator: initial.duplicator,
      operationGate: initial.gate,
    });
    expect(await service.duplicate({ sourceProfileId: 'main', name: 'Copy' })).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_store_conflict' }],
    });
    expect(existsSync(join(initial.root, `wallet-${TARGET_ID}.db`))).toBe(false);
    expect(initial.manifestStore.read()).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({
        manifest: expect.objectContaining({ profiles: [expect.objectContaining({ id: 'main' })] }),
      }),
    }));
  });

  it('validates all input and gate state before invoking the database boundary', async () => {
    const root = temporaryRoot('coqui-duplicate-validation-');
    const manifestStore = createFileProfileManifestStore(join(root, 'wallet-profiles.json'));
    const gate = createProfileOperationGate();
    const duplicator: ProfileDatabaseDuplicator = {
      duplicate: vi.fn(), discard: vi.fn(),
    };
    const service = new AccountsProfileDuplicationService({
      clock: { nowMs: vi.fn() }, idSource: { nextId: vi.fn() }, manifestStore,
      databaseDuplicator: duplicator, operationGate: gate,
    });
    expect(await service.duplicate({ sourceProfileId: 'bad/path', name: '' })).toEqual({
      ok: false,
      issues: [
        { path: ['sourceProfileId'], code: 'invalid_profile_id' },
        { path: ['name'], code: 'invalid_name' },
      ],
    });
    expect(gate.begin()).toBe(true);
    expect(await service.duplicate({ sourceProfileId: 'main', name: 'Copy' })).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_operation_in_progress' }],
    });
    gate.end();
    expect(duplicator.duplicate).not.toHaveBeenCalled();
  });

  it('never discards a clone that a concurrent manifest now references', async () => {
    const source = {
      id: 'main', name: 'Main', color: '#60a5fa' as const, icon: 'wallet' as const,
      dbFilename: 'kokintrader.db', createdAt: 1, lastOpenedAt: 1, order: 0,
    };
    const duplicate = {
      id: TARGET_ID, name: 'Copy', color: '#60a5fa' as const, icon: 'wallet' as const,
      dbFilename: `wallet-${TARGET_ID}.db`, createdAt: 50, lastOpenedAt: 50, order: 1,
    };
    let reads = 0;
    const manifestStore: ProfileManifestStore = {
      read() {
        reads += 1;
        return {
          ok: true,
          value: {
            revision: (reads === 1 ? 'a' : 'b').repeat(64),
            manifest: {
              version: 1,
              activeProfileId: 'main',
              profiles: reads === 1 ? [source] : [source, duplicate],
            },
          },
        };
      },
      replace: () => ({ ok: false, code: 'conflict' }),
    };
    const discard = vi.fn(async () => ({ ok: true }));
    const databaseDuplicator: ProfileDatabaseDuplicator = {
      duplicate: vi.fn(async () => ({
        ok: true as const,
        evidence: {
          schemaVersion: 41,
          databaseSha256: 'c'.repeat(64),
          profileScopedTableCount: 28,
          rewrittenRowCount: 0,
          excludedTransientRowCount: 0,
          clearedCredentialMetadataCount: 0,
          integrityVerified: true as const,
        },
      })),
      discard,
    };
    const service = new AccountsProfileDuplicationService({
      clock: new FixedClock(50), idSource: { nextId: () => TARGET_ID },
      manifestStore, databaseDuplicator,
    });
    expect(await service.duplicate({ sourceProfileId: 'main', name: 'Copy' })).toEqual({
      ok: false,
      issues: [{ path: [], code: 'profile_duplicate_cleanup_required' }],
    });
    expect(discard).not.toHaveBeenCalled();
  });
});
