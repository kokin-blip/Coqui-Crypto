import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createCoinbaseProfileContextFactory,
  createProfileContexts,
  createProfileDatabaseProvisioner,
} from '../apps/desktop/src/main/profile-contexts.js';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'coqui-profiles-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('provisioning creates a migrated database', () => {
  it('opens, migrates and closes', async () => {
    const provisioner = createProfileDatabaseProvisioner(directory);
    expect(await provisioner.provision('main', 'wallet-main.db')).toEqual({ ok: true });

    // Migrating at creation means a profile that cannot be migrated fails while
    // the user is still looking at the dialog that created it.
    const contexts = createProfileContexts(directory);
    const prepared = await contexts.prepare('main', 'wallet-main.db');
    expect(prepared.ok).toBe(true);
    if (prepared.ok) await prepared.context.commit();
    const version = contexts.active()?.database.prepare('PRAGMA user_version').get();
    expect(Number((version as { user_version: number }).user_version)).toBeGreaterThan(0);
    contexts.dispose();
  });

  it('refuses a filename that could escape the data directory', async () => {
    const provisioner = createProfileDatabaseProvisioner(directory);

    // A profile database is named by the manifest, and a manifest is a file.
    // The guard is here because "the caller validates it" is how traversal
    // bugs are written.
    expect(await provisioner.provision('main', '../escape.db')).toEqual({ ok: false });
    expect(await provisioner.provision('main', '/etc/passwd')).toEqual({ ok: false });
    expect(await provisioner.provision('main', 'wallet-main.sqlite')).toEqual({ ok: false });
  });
});

describe('only one profile is ever open', () => {
  it('closes the previous context when the next commits', async () => {
    const contexts = createProfileContexts(directory);

    const first = await contexts.prepare('main', 'wallet-main.db');
    if (!first.ok) throw new Error('prepare failed');
    await first.context.commit();
    const firstDatabase = contexts.active()?.database;

    const second = await contexts.prepare('other', 'wallet-other.db');
    if (!second.ok) throw new Error('prepare failed');
    await second.context.commit();

    expect(contexts.active()?.profileId).toBe('other');
    // Two live connections to two profiles is the shape cross-wallet leakage
    // takes: a query issued against whichever handle a closure captured.
    expect(() => firstDatabase?.prepare('SELECT 1').get()).toThrow();
    contexts.dispose();
  });

  it('refuses a second preparation while one is pending', async () => {
    const contexts = createProfileContexts(directory);
    const first = await contexts.prepare('main', 'wallet-main.db');

    // Two overlapping preparations could both commit, and the loser's
    // connection would leak with no handle left to close it.
    expect(await contexts.prepare('other', 'wallet-other.db')).toEqual({ ok: false });
    if (first.ok) await first.context.abort();
    expect((await contexts.prepare('other', 'wallet-other.db')).ok).toBe(true);
    contexts.dispose();
  });
});

describe('a failed switch leaves the user where they were', () => {
  it('keeps the active context when the prepared one is aborted', async () => {
    const contexts = createProfileContexts(directory);
    const first = await contexts.prepare('main', 'wallet-main.db');
    if (!first.ok) throw new Error('prepare failed');
    await first.context.commit();

    const second = await contexts.prepare('other', 'wallet-other.db');
    if (!second.ok) throw new Error('prepare failed');
    await second.context.abort();

    expect(contexts.active()?.profileId).toBe('main');
    // Still usable: aborting a switch must not disturb the connection the user
    // is reading from.
    expect(contexts.active()?.database.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
    contexts.dispose();
  });

  it('ignores a commit after an abort', async () => {
    const contexts = createProfileContexts(directory);
    const prepared = await contexts.prepare('main', 'wallet-main.db');
    if (!prepared.ok) throw new Error('prepare failed');

    await prepared.context.abort();
    expect(await prepared.context.commit()).toEqual({ ok: false });
    expect(contexts.active()).toBeNull();
    contexts.dispose();
  });
});

describe('a sync opens its own scoped context', () => {
  it('opens the named profile and closes on request', () => {
    const open = createCoinbaseProfileContextFactory(directory);
    const context = open({ profileId: 'main', databaseFilename: 'wallet-main.db' });

    // A background refresh must not require switching the user's view, so it
    // gets its own connection rather than borrowing the active one.
    expect(context.database.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
    context.close();
    expect(() => context.database.prepare('SELECT 1').get()).toThrow();
  });

  it('refuses to open outside the data directory', () => {
    const open = createCoinbaseProfileContextFactory(directory);
    expect(() => open({ profileId: 'main', databaseFilename: '../elsewhere.db' }))
      .toThrow('outside the data directory');
  });
});
