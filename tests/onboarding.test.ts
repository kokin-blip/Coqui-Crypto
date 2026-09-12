import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FixedClock } from '../packages/core/src/index.js';
import { PersonIdentityService, ProfileReadinessService } from '../packages/services/src/index.js';
import { createFilePersonIdentityStore, openDatabase, parsePersonIdentity } from '../packages/storage/src/index.js';

const NOW = 1_800_000_000_000;

describe('local person identity', () => {
  it('normalizes a display name and persists no financial or provider identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coqui-person-'));
    const path = join(directory, 'coqui-person.json');
    const service = new PersonIdentityService(createFilePersonIdentityStore(path), new FixedClock(NOW));

    expect(service.status()).toMatchObject({ ok: true, value: { displayName: null, introState: 'not_started' } });
    expect(service.setDisplayName('  Kokin   Martinez  ')).toMatchObject({
      ok: true, value: { displayName: 'Kokin Martinez', introState: 'in_progress' },
    });
    const raw = readFileSync(path, 'utf8');
    expect(parsePersonIdentity(raw)?.displayName).toBe('Kokin Martinez');
    expect(raw).not.toMatch(/api.?key|credential|portfolio|account/i);
  });

  it('persists skip, restart, and service-owned completion states', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coqui-person-'));
    const service = new PersonIdentityService(
      createFilePersonIdentityStore(join(directory, 'coqui-person.json')),
      new FixedClock(NOW),
    );
    expect(service.skip()).toMatchObject({ ok: true, value: { introState: 'skipped', skippedAtMs: NOW } });
    expect(service.restart()).toMatchObject({ ok: true, value: { introState: 'in_progress', skippedAtMs: null } });
    expect(service.markPortfolioReady()).toMatchObject({ ok: true, value: { introState: 'portfolio_ready', completedAtMs: NOW } });
  });

  it('rejects control characters and blank names', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coqui-person-'));
    const service = new PersonIdentityService(
      createFilePersonIdentityStore(join(directory, 'coqui-person.json')),
      new FixedClock(NOW),
    );
    expect(service.setDisplayName('   ')).toMatchObject({ ok: false });
    expect(service.setDisplayName('Kokin\u0000')).toMatchObject({ ok: false });
  });

  it('recovers a corrupt local identity on the next explicit name save', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coqui-person-'));
    const path = join(directory, 'coqui-person.json');
    writeFileSync(path, '{not-json', 'utf8');
    const service = new PersonIdentityService(createFilePersonIdentityStore(path), new FixedClock(NOW));
    expect(service.status()).toMatchObject({ ok: true, value: { displayName: null, introState: 'not_started' } });
    expect(service.setDisplayName('Kokin')).toMatchObject({ ok: true, value: { displayName: 'Kokin' } });
    expect(parsePersonIdentity(readFileSync(path, 'utf8'))?.displayName).toBe('Kokin');
  });
});

describe('profile readiness', () => {
  it('derives a fresh profile from durable facts instead of optimistic UI state', () => {
    const database = openDatabase(':memory:');
    const view = new ProfileReadinessService(database, new FixedClock(NOW)).view('main');
    expect(view.stage).toBe('connection');
    expect(view.portfolioReady).toBe(false);
    expect(view.firstDecisionComplete).toBe(false);
    expect(view.steps.map((step) => step.status)).toEqual([
      'current', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending',
    ]);
    database.close();
  });
});
