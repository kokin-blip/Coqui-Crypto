import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySecretStore } from '../packages/adapters/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import {
  AccountsProfileDeletionPreviewService,
  AccountsProfileService,
  createProfileCredentialPresenceSource,
  createProfileOperationGate,
  type ProfileDeletionImpactReader,
} from '../packages/services/src/index.js';
import {
  createFileProfileManifestStore,
  openDatabase,
  readProfileDeletionImpact,
  type ProfileBackupStore,
} from '../packages/storage/src/index.js';

const ID_A = '00000000-0000-4000-8000-000000000001';
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'coqui-delete-preview-'));
  temporaryDirectories.push(directory);
  const manifestPath = join(directory, 'wallet-profiles.json');
  const manifestStore = createFileProfileManifestStore(manifestPath);
  const profiles = new AccountsProfileService({
    clock: new FixedClock(1),
    idSource: { nextId: () => ID_A },
    manifestStore,
    databaseProvisioner: {
      async provision(_profileId, dbFilename) {
        const database = openDatabase(join(directory, dbFilename));
        database.close();
        return { ok: true };
      },
    },
  });
  profiles.initializeMain('kokintrader.db');
  return { directory, manifestPath, manifestStore, profiles };
}

const COUNTS = Object.freeze({
  openTaxLots: 2,
  disposals: 1,
  portfolioEvidenceRecords: 3,
  paperEvidenceRecords: 4,
  researchEvidenceRecords: 5,
  alertEvidenceRecords: 6,
  importEvidenceRecords: 7,
  operationalEvidenceRecords: 8,
});

describe('profile deletion impact storage', () => {
  it('counts durable categories without returning record content', () => {
    const database = openDatabase(':memory:');
    expect(readProfileDeletionImpact(ID_A, database)).toEqual({
      openTaxLots: 0, disposals: 0, portfolioEvidenceRecords: 0,
      paperEvidenceRecords: 0, researchEvidenceRecords: 0,
      alertEvidenceRecords: 0, importEvidenceRecords: 0,
      operationalEvidenceRecords: 0,
    });
    database.prepare(`
      INSERT INTO tax_lots_v2 (
        id, venue, product_id, product_type, symbol, asset_name, base_asset,
        quote_asset, coingecko_id, quantity_text, remaining_text, cost_usd_text,
        acquired_at, source, external_id
      ) VALUES (?, 'coinbase', 'BTC-USD', 'spot', 'BTC', 'Bitcoin', 'BTC',
        'USD', 'bitcoin', '1', '1', '100', 1, 'manual', NULL)
    `).run('lot-1');
    database.prepare(`
      INSERT INTO allocation_targets_v2 (venue, product_id, product_type, weight)
      VALUES ('coinbase', 'BTC-USD', 'spot', 1)
    `).run();
    database.prepare(`
      INSERT INTO alert_events_v2 (
        id, profile_id, event_key, kind, severity, reason_code, evidence_hash,
        venue, product_id, product_type, occurred_at, recorded_at
      ) VALUES (?, ?, 'event:1', 'policy_event', 'info', 'policy_changed', ?,
        NULL, NULL, NULL, 1, 1)
    `).run('alert-1', ID_A, 'a'.repeat(64));
    database.prepare(`
      INSERT INTO runtime_incidents (
        id, profile_id, run_id, kind, severity, source, detail_json,
        occurred_at, resolved_at, resolution
      ) VALUES (?, ?, NULL, 'stale_data', 'warning', 'test', '{}', 1, NULL, NULL)
    `).run('incident-1', ID_A);

    expect(readProfileDeletionImpact(ID_A, database)).toEqual({
      openTaxLots: 1,
      disposals: 0,
      portfolioEvidenceRecords: 1,
      paperEvidenceRecords: 0,
      researchEvidenceRecords: 0,
      alertEvidenceRecords: 1,
      importEvidenceRecords: 0,
      operationalEvidenceRecords: 1,
    });
    database.close();
  });
});

describe('accounts profile deletion preview', () => {
  it('returns a complete immutable consequence preview without mutating any source', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Research' });
    const beforeManifest = readFileSync(target.manifestPath, 'utf8');
    const secret = 'profile-secret-material';
    const secretStore = createMemorySecretStore({
      [`coinbase-credentials:${ID_A}`]: secret,
      [`gemini-api-key:${ID_A}`]: 'advisor-secret-material',
    });
    const impactReader: ProfileDeletionImpactReader = {
      inspect: vi.fn(async () => ({ ok: true, impact: COUNTS })),
    };
    const service = new AccountsProfileDeletionPreviewService({
      clock: new FixedClock(50), manifestStore: target.manifestStore, impactReader,
      credentialPresence: createProfileCredentialPresenceSource(secretStore),
    });

    const result = await service.preview(ID_A);
    expect(result).toEqual({
      ok: true,
      value: {
        asOfMs: 50,
        profileId: ID_A,
        profileName: 'Research',
        isActive: false,
        isLastProfile: false,
        inspectionStatus: 'complete',
        impact: COUNTS,
        totalDurableRecords: 36,
        credentialKinds: ['advisor_gemini', 'coinbase'],
        backupStatus: 'not_provided',
        backupId: null,
        blockerCodes: ['recoverable_backup_required'],
        warningCodes: ['durable_evidence_present', 'credentials_present'],
        deletionEligible: false,
        explicitConfirmationRequired: true,
      },
    });
    expect(impactReader.inspect).toHaveBeenCalledWith(ID_A, `wallet-${ID_A}.db`);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('advisor-secret-material');
    expect(JSON.stringify(result)).not.toContain(`wallet-${ID_A}.db`);
    expect(readFileSync(target.manifestPath, 'utf8')).toBe(beforeManifest);
    expect(await secretStore.read('coinbase-credentials', ID_A)).toEqual({
      ok: true, value: secret,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.impact)).toBe(true);
  });

  it('blocks active and last-profile deletion even when inspection is complete', async () => {
    const target = setup();
    const service = new AccountsProfileDeletionPreviewService({
      clock: new FixedClock(10),
      manifestStore: target.manifestStore,
      impactReader: { inspect: async () => ({ ok: true, impact: { ...COUNTS,
        openTaxLots: 0, disposals: 0, portfolioEvidenceRecords: 0,
        paperEvidenceRecords: 0, researchEvidenceRecords: 0,
        alertEvidenceRecords: 0, importEvidenceRecords: 0,
        operationalEvidenceRecords: 0,
      } }) },
      credentialPresence: { inspect: async () => ({ ok: true, credentialKinds: [] }) },
    });
    expect(await service.preview('main')).toEqual({
      ok: true,
      value: expect.objectContaining({
        isActive: true,
        isLastProfile: true,
        blockerCodes: ['last_profile', 'active_profile', 'recoverable_backup_required'],
        warningCodes: [],
        deletionEligible: false,
      }),
    });
  });

  it('still requires a recoverable backup for a fully inspected empty profile', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Empty' });
    const zero = Object.fromEntries(Object.keys(COUNTS).map((key) => [key, 0])) as
      unknown as typeof COUNTS;
    const service = new AccountsProfileDeletionPreviewService({
      clock: new FixedClock(10), manifestStore: target.manifestStore,
      impactReader: { inspect: async () => ({ ok: true, impact: zero }) },
      credentialPresence: { inspect: async () => ({ ok: true, credentialKinds: [] }) },
    });
    expect(await service.preview(ID_A)).toEqual({
      ok: true,
      value: expect.objectContaining({
        inspectionStatus: 'complete',
        totalDurableRecords: 0,
        backupStatus: 'not_provided',
        backupId: null,
        blockerCodes: ['recoverable_backup_required'],
        warningCodes: [],
        deletionEligible: false,
        explicitConfirmationRequired: true,
      }),
    });
  });

  it('marks an inactive profile eligible only with a fresh verified backup', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Empty' });
    const loaded = target.manifestStore.read();
    if (!loaded.ok || !loaded.value) throw new Error('Expected a profile manifest.');
    const zero = Object.fromEntries(Object.keys(COUNTS).map((key) => [key, 0])) as
      unknown as typeof COUNTS;
    const backupId = '00000000-0000-4000-8000-000000000099';
    const artifactName = `coqui-profile-backup-10-${backupId}`;
    const backupStore: ProfileBackupStore = {
      create: vi.fn(async () => ({ ok: false as const, code: 'invalid_input' as const })),
      verify: vi.fn(async () => ({
        ok: true as const,
        backup: Object.freeze({
          formatVersion: 1,
          backupId,
          artifactName,
          profileId: ID_A,
          createdAtMs: 10,
          sourceManifestRevision: loaded.value!.revision,
          schemaVersion: 41,
          databaseSha256: 'a'.repeat(64),
          manifestSha256: 'b'.repeat(64),
          totalDurableRecords: 0,
          impact: Object.freeze(zero),
          credentialKinds: Object.freeze([]),
          credentialsIncluded: false,
          verified: true,
        }),
      })),
    };
    const service = new AccountsProfileDeletionPreviewService({
      clock: new FixedClock(10),
      manifestStore: target.manifestStore,
      impactReader: { inspect: async () => ({ ok: true, impact: zero }) },
      credentialPresence: { inspect: async () => ({ ok: true, credentialKinds: [] }) },
      backupStore,
    });
    expect(await service.preview(ID_A, artifactName)).toEqual({
      ok: true,
      value: expect.objectContaining({
        backupStatus: 'verified',
        backupId,
        blockerCodes: [],
        deletionEligible: true,
      }),
    });
    expect(backupStore.verify).toHaveBeenCalledWith(artifactName, ID_A);
  });

  it('returns an incomplete fail-closed preview when either inspection boundary fails', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Research' });
    const diagnostic = 'secret-bearing reader failure';
    const service = new AccountsProfileDeletionPreviewService({
      clock: new FixedClock(10), manifestStore: target.manifestStore,
      impactReader: { inspect: async () => { throw new Error(diagnostic); } },
      credentialPresence: { inspect: async () => ({ ok: false }) },
    });
    const result = await service.preview(ID_A);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        inspectionStatus: 'incomplete',
        impact: null,
        totalDurableRecords: null,
        credentialKinds: [],
        backupStatus: 'not_provided',
        backupId: null,
        blockerCodes: [
          'impact_unavailable',
          'credential_presence_unavailable',
          'recoverable_backup_required',
        ],
        warningCodes: [],
        deletionEligible: false,
      }),
    });
    expect(JSON.stringify(result)).not.toContain(diagnostic);
  });

  it('validates identity and shared switch state before time or inspection', async () => {
    const target = setup();
    const gate = createProfileOperationGate();
    const nowMs = vi.fn(() => 10);
    const impactReader: ProfileDeletionImpactReader = { inspect: vi.fn() };
    const credentialPresence = { inspect: vi.fn() };
    const service = new AccountsProfileDeletionPreviewService({
      clock: { nowMs }, manifestStore: target.manifestStore, impactReader,
      credentialPresence, operationGate: gate,
    });
    expect(await service.preview('bad/profile')).toEqual({
      ok: false, issues: [{ path: ['profileId'], code: 'invalid_profile_id' }],
    });
    expect(gate.begin()).toBe(true);
    expect(await service.preview('main')).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_operation_in_progress' }],
    });
    gate.end();
    expect(nowMs).not.toHaveBeenCalled();
    expect(impactReader.inspect).not.toHaveBeenCalled();
    expect(credentialPresence.inspect).not.toHaveBeenCalled();
  });
});
