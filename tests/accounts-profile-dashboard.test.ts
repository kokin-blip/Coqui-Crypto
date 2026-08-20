import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decimal, instrumentKey, type AssetRef } from '../packages/core/src/index.js';
import {
  AccountsProfileComparisonService,
  AccountsProfileDashboardService,
  AccountsProfileService,
  createProfileOperationGate,
  type ProfileComparisonView,
} from '../packages/services/src/index.js';
import {
  activateWalletSafetyStop,
  appendRuntimeIncident,
  bootstrapPaperBalances,
  createFileProfileComparisonFactsReader,
  createFileProfileDashboardFactsReader,
  createFileProfileManifestStore,
  ensureWalletUtcSchedule,
  insertTaxLots,
  openDatabase,
  saveWalletRiskState,
  type ProfileDashboardFactsReader,
  type ProfileManifestStore,
} from '../packages/storage/src/index.js';

const PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD', coingeckoId: 'bitcoin',
};
const ETH: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
  symbol: 'ETH', name: 'Ethereum', baseAsset: 'ETH', quoteAsset: 'USD', coingeckoId: 'ethereum',
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'coqui-profile-dashboard-'));
  temporaryDirectories.push(root);
  const manifestStore = createFileProfileManifestStore(join(root, 'wallet-profiles.json'));
  const gate = createProfileOperationGate();
  const profiles = new AccountsProfileService({
    clock: { nowMs: () => 1 }, idSource: { nextId: () => PROFILE_ID },
    manifestStore, operationGate: gate,
    databaseProvisioner: {
      async provision(_profileId, dbFilename) {
        openDatabase(join(root, dbFilename)).close();
        return { ok: true };
      },
    },
  });
  profiles.initializeMain('kokintrader.db');
  openDatabase(join(root, 'kokintrader.db')).close();
  return { root, manifestStore, gate, profiles };
}

function seed(target: ReturnType<typeof setup>) {
  const loaded = target.manifestStore.read();
  if (!loaded.ok || !loaded.value) throw new Error('Expected profile manifest.');
  expect(target.manifestStore.replace(loaded.value.revision, {
    ...loaded.value.manifest,
    profiles: loaded.value.manifest.profiles.map((profile) => profile.id === 'main'
      ? { ...profile, coinbaseKeyFingerprint: 'a'.repeat(64) }
      : profile),
  }).ok).toBe(true);

  const main = openDatabase(join(target.root, 'kokintrader.db'));
  insertTaxLots([{
    id: 'main-lot', asset: BTC, quantity: decimal('1'), remaining: decimal('1'),
    costUsd: decimal('50'), acquiredAt: 1, source: 'manual', externalId: null,
  }], main);
  bootstrapPaperBalances('main', [
    { assetId: 'USD', quantity: '1000' },
    { assetId: instrumentKey(BTC.instrument), quantity: '1' },
  ], 'main-open', 1, main);
  main.prepare("INSERT INTO app_settings (key, value) VALUES ('coinbase.last_sync_at', '950')").run();
  ensureWalletUtcSchedule('main', 100, 0, 900, main);
  saveWalletRiskState({
    profileId: 'main', stage: 'hard_stop', dailyPeakUsd: '1000', rollingPeakUsd: '1000',
    lifetimePeakUsd: '1000', hardStopped: true, reason: 'drawdown', updatedAt: 940,
  }, main);
  activateWalletSafetyStop({
    eventId: 'stop-1', profileId: 'main', kind: 'drawdown',
    reason: 'secret-bearing safety diagnostic', at: 930,
  }, main);
  appendRuntimeIncident({
    id: 'incident-1', profileId: 'main', runId: null, kind: 'scheduler_failure',
    severity: 'blocking', source: 'test', detailJson: '{"secret":"do-not-return"}',
    occurredAt: 920, resolvedAt: null, resolution: null,
  }, main);
  main.close();

  const other = openDatabase(join(target.root, `wallet-${PROFILE_ID}.db`));
  insertTaxLots([{
    id: 'other-lot', asset: ETH, quantity: decimal('2'), remaining: decimal('2'),
    costUsd: decimal('100'), acquiredAt: 1, source: 'manual', externalId: null,
  }], other);
  bootstrapPaperBalances(PROFILE_ID, [{ assetId: 'USD', quantity: '500' }], 'other-open', 1, other);
  other.close();
}

describe('accounts multi-profile dashboard', { timeout: 20_000 }, () => {
  it('aggregates exact valuation and sanitized operational evidence without secret reads', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Research' });
    seed(target);
    const comparison = new AccountsProfileComparisonService({
      clock: { nowMs: () => 900 },
      manifestStore: target.manifestStore,
      factsReader: createFileProfileComparisonFactsReader(target.root),
      priceSource: {
        name: 'coinbase-dashboard',
        spot: async () => new Map([[instrumentKey(BTC.instrument), {
          priceUsd: decimal('100'), source: 'coinbase', quality: 'venue_reported_last',
          observedAtMs: 890,
        }]]),
      },
      operationGate: target.gate,
    });
    const service = new AccountsProfileDashboardService({
      clock: { nowMs: () => 1000 },
      manifestStore: target.manifestStore,
      comparisonSource: comparison,
      factsReader: createFileProfileDashboardFactsReader(target.root),
      operationGate: target.gate,
    });

    const result = await service.dashboard();

    expect(result).toEqual({
      ok: true,
      value: {
        asOfMs: 1000,
        valuationRequestedAtMs: 900,
        valuationReceivedAtMs: 900,
        requestedSource: 'coinbase-dashboard',
        status: 'partial',
        profileCount: 2,
        trackedPricedSubtotalUsd: '100',
        trackedCompleteTotalUsd: null,
        paperPricedSubtotalUsd: '1600',
        paperCompleteTotalUsd: '1600',
        profiles: [
          expect.objectContaining({
            id: 'main', dataStatus: 'partial', coinbaseConfigurationHint: 'configured',
            freshness: { state: 'fresh', asOfMs: 950, ageMs: 50 },
            automation: {
              health: 'overdue', cadenceMs: 100, utcOffsetMs: 0,
              nextRunAtMs: 900, lastRunAtMs: null, leaseActive: false,
              leaseExpiresAtMs: null, reasonCode: null,
            },
            risk: { stageCode: 'hard_stop', hardStopped: true, updatedAtMs: 940 },
            safetyStop: {
              active: true, kindCode: 'drawdown', triggeredAtMs: 930, acknowledgedAtMs: null,
            },
            unresolvedIncidentCount: 1,
            warningCodes: [
              'schedule_overdue', 'hard_stop_active', 'safety_stop_active',
              'unresolved_incidents',
            ],
          }),
          expect.objectContaining({
            id: PROFILE_ID, dataStatus: 'partial', coinbaseConfigurationHint: 'not_configured',
            freshness: { state: 'not_configured', asOfMs: null, ageMs: null },
            automation: expect.objectContaining({ health: 'not_configured' }),
            risk: null, safetyStop: null, unresolvedIncidentCount: 0,
            warningCodes: ['tracked_valuation_incomplete'],
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-bearing');
    expect(serialized).not.toContain('do-not-return');
    expect(serialized).not.toContain('source-owner');
    expect(serialized).not.toContain('wallet-');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.profiles)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.profiles[0]!.warningCodes)).toBe(true);
  });

  it('reports operational read failure without replacing valid valuation with zero', async () => {
    const target = setup();
    const comparison = new AccountsProfileComparisonService({
      clock: { nowMs: () => 10 }, manifestStore: target.manifestStore,
      factsReader: createFileProfileComparisonFactsReader(target.root),
      priceSource: { name: 'none', spot: vi.fn() }, operationGate: target.gate,
    });
    const service = new AccountsProfileDashboardService({
      clock: { nowMs: () => 20 }, manifestStore: target.manifestStore,
      comparisonSource: comparison,
      factsReader: { read: async () => ({ ok: false, code: 'corrupt' }) },
      operationGate: target.gate,
    });
    expect(await service.dashboard()).toEqual({
      ok: true,
      value: expect.objectContaining({
        status: 'partial',
        trackedCompleteTotalUsd: '0',
        paperCompleteTotalUsd: '0',
        profiles: [expect.objectContaining({
          dataStatus: 'partial',
          tracked: expect.objectContaining({ completeValueUsd: '0' }),
          automation: null,
          unresolvedIncidentCount: null,
          warningCodes: ['operational_status_unavailable'],
        })],
      }),
    });
  });

  it('rejects malformed persisted operational timestamps as corrupt evidence', async () => {
    const target = setup();
    const database = openDatabase(join(target.root, 'kokintrader.db'));
    database.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('coinbase.last_sync_at', 'not-a-time')",
    ).run();
    database.close();

    expect(await createFileProfileDashboardFactsReader(target.root).read(
      'main',
      'kokintrader.db',
    )).toEqual({ ok: false, code: 'corrupt' });
  });

  it('fails closed when the manifest changes between valuation and operational capture', async () => {
    const target = setup();
    const compared: ProfileComparisonView = {
      requestedAtMs: 1, receivedAtMs: 1, requestedSource: 'test',
      requestedProfileCount: 1, availableProfileCount: 1, unavailableProfileCount: 0,
      pricing: { status: 'not_required', requestedCount: 0, pricedCount: 0, unpricedCount: 0, sources: [] },
      profiles: [{
        id: PROFILE_ID, name: 'Gone', color: '#60a5fa', icon: 'wallet', isActive: false,
        status: 'available', schemaVersion: 41,
        tracked: {
          openLotCount: 0, disposalCount: 0, pricedSubtotalUsd: decimal('0'),
          completeValueUsd: decimal('0'), totalCostUsd: decimal('0'),
          pricedUnrealizedPnlUsd: '0', pricedHoldingCount: 0,
          unpricedHoldingCount: 0, unpricedInstruments: [],
        },
        paper: {
          cashUsd: decimal('0'), pricedAssetValueUsd: decimal('0'),
          completeValueUsd: decimal('0'),
          pricedAssetCount: 0, unpricedAssetCount: 0, unpricedInstruments: [],
        },
        pricing: { status: 'not_required', requestedCount: 0, pricedCount: 0, unpricedCount: 0, sources: [] },
      }],
    };
    const reader: ProfileDashboardFactsReader = { read: vi.fn() };
    const service = new AccountsProfileDashboardService({
      clock: { nowMs: () => 10 }, manifestStore: target.manifestStore,
      comparisonSource: { compare: async () => ({ ok: true, value: compared }) },
      factsReader: reader, operationGate: target.gate,
    });
    expect(await service.dashboard()).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_dashboard_snapshot_conflict' }],
    });
    expect(reader.read).not.toHaveBeenCalled();
  });

  it('caps operational readers at four and preserves dashboard order', async () => {
    const records = Array.from({ length: 9 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `P${index}`, color: '#60a5fa' as const, icon: 'wallet' as const,
      dbFilename: `wallet-00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}.db`,
      createdAt: 1, lastOpenedAt: 1, order: index,
    }));
    const manifestStore: ProfileManifestStore = {
      read: () => ({ ok: true, value: {
        revision: 'a'.repeat(64),
        manifest: { version: 1, activeProfileId: records[0]!.id, profiles: records },
      } }),
      replace: () => ({ ok: false, code: 'invalid_manifest' }),
    };
    const emptyTracked = {
      openLotCount: 0, disposalCount: 0, pricedSubtotalUsd: decimal('0'), completeValueUsd: decimal('0'),
      totalCostUsd: decimal('0'), pricedUnrealizedPnlUsd: '0', pricedHoldingCount: 0,
      unpricedHoldingCount: 0, unpricedInstruments: [],
    };
    const emptyPaper = {
      cashUsd: decimal('0'), pricedAssetValueUsd: decimal('0'), completeValueUsd: decimal('0'),
      pricedAssetCount: 0, unpricedAssetCount: 0, unpricedInstruments: [],
    };
    const compared: ProfileComparisonView = {
      requestedAtMs: 1, receivedAtMs: 1, requestedSource: 'none',
      requestedProfileCount: 9, availableProfileCount: 9, unavailableProfileCount: 0,
      pricing: { status: 'not_required', requestedCount: 0, pricedCount: 0, unpricedCount: 0, sources: [] },
      profiles: records.map((record, index) => ({
        id: record.id, name: record.name, color: record.color, icon: record.icon,
        isActive: index === 0, status: 'available', schemaVersion: 41,
        tracked: emptyTracked, paper: emptyPaper,
        pricing: { status: 'not_required', requestedCount: 0, pricedCount: 0, unpricedCount: 0, sources: [] },
      })),
    };
    let active = 0;
    let peak = 0;
    const factsReader: ProfileDashboardFactsReader = {
      async read() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {
          ok: true,
          facts: {
            schemaVersion: 41, lastCoinbaseSyncAtMs: null, schedule: null,
            riskState: null, safetyStop: null, unresolvedIncidents: [],
          },
        };
      },
    };
    const service = new AccountsProfileDashboardService({
      clock: { nowMs: () => 10 }, manifestStore,
      comparisonSource: { compare: async () => ({ ok: true, value: compared }) }, factsReader,
    });
    const result = await service.dashboard();
    expect(peak).toBe(4);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        profiles: records.map((record) => expect.objectContaining({ id: record.id })),
      }),
    });
  });
});
