import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  decimal,
  instrumentKey,
  type AssetRef,
  type PriceSource,
} from '../packages/core/src/index.js';
import {
  AccountsProfileComparisonService,
  AccountsProfileService,
  createProfileOperationGate,
} from '../packages/services/src/index.js';
import {
  bootstrapPaperBalances,
  createFileProfileComparisonFactsReader,
  createFileProfileManifestStore,
  insertDisposals,
  insertTaxLots,
  openDatabase,
  type ProfileComparisonFactsReader,
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
const LTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'LTC-USD', productType: 'spot' },
  symbol: 'LTC', name: 'Litecoin', baseAsset: 'LTC', quoteAsset: 'USD', coingeckoId: 'litecoin',
};
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'coqui-profile-compare-'));
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
  const main = openDatabase(join(target.root, 'kokintrader.db'));
  insertTaxLots([{
    id: 'main-lot', asset: BTC, quantity: decimal('2'), remaining: decimal('2'),
    costUsd: decimal('100'), acquiredAt: 1, source: 'manual', externalId: null,
  }], main);
  bootstrapPaperBalances('main', [
    { assetId: 'USD', quantity: '1000' },
    { assetId: instrumentKey(BTC.instrument), quantity: '1' },
  ], 'main-opening', 1, main);
  main.close();

  const other = openDatabase(join(target.root, `wallet-${PROFILE_ID}.db`));
  insertTaxLots([{
    id: 'other-lot', asset: ETH, quantity: decimal('1'), remaining: decimal('1'),
    costUsd: decimal('50'), acquiredAt: 1, source: 'manual', externalId: null,
  }], other);
  insertDisposals([{
    id: 'other-disposal', asset: ETH, quantity: decimal('1'), proceedsUsd: decimal('70'),
    costBasisUsd: decimal('50'), realizedPnlUsd: decimal('20'), longTerm: false,
    disposedAt: 2, method: 'fifo', source: 'manual',
  }], other);
  bootstrapPaperBalances(PROFILE_ID, [
    { assetId: 'USD', quantity: '500' },
    { assetId: instrumentKey(LTC.instrument), quantity: '2' },
  ], 'other-opening', 1, other);
  other.close();
}

function priceSource(): PriceSource {
  return {
    name: 'comparison-composite',
    spot: vi.fn(async () => new Map([
      [instrumentKey(BTC.instrument), {
        priceUsd: decimal('100'), source: 'coinbase', quality: 'venue_reported_last' as const,
        observedAtMs: 90,
      }],
      [instrumentKey(ETH.instrument), {
        priceUsd: decimal('60'), source: 'coingecko', quality: 'reference_market' as const,
        observedAtMs: null,
      }],
    ])),
  };
}

describe('accounts profile comparison', { timeout: 20_000 }, () => {
  it('returns deterministic exact summaries with explicit partial-valuation provenance', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Research' });
    seed(target);
    const prices = priceSource();
    const times = [100, 110];
    const service = new AccountsProfileComparisonService({
      clock: { nowMs: () => times.shift()! },
      manifestStore: target.manifestStore,
      factsReader: createFileProfileComparisonFactsReader(target.root),
      priceSource: prices,
      operationGate: target.gate,
    });

    const result = await service.compare();

    expect(result).toEqual({
      ok: true,
      value: {
        requestedAtMs: 100,
        receivedAtMs: 110,
        requestedSource: 'comparison-composite',
        requestedProfileCount: 2,
        availableProfileCount: 2,
        unavailableProfileCount: 0,
        pricing: {
          status: 'partial', requestedCount: 3, pricedCount: 2, unpricedCount: 1,
          sources: [
            { source: 'coinbase', quality: 'venue_reported_last', pricedCount: 1 },
            { source: 'coingecko', quality: 'reference_market', pricedCount: 1 },
          ],
        },
        profiles: [
          expect.objectContaining({
            id: 'main', isActive: true, status: 'available', schemaVersion: 45,
            tracked: {
              openLotCount: 1, disposalCount: 0, pricedSubtotalUsd: '200',
              completeValueUsd: '200', totalCostUsd: '100', pricedUnrealizedPnlUsd: '100',
              pricedHoldingCount: 1, unpricedHoldingCount: 0, unpricedInstruments: [],
            },
            paper: {
              cashUsd: '1000', pricedAssetValueUsd: '100', completeValueUsd: '1100',
              pricedAssetCount: 1, unpricedAssetCount: 0, unpricedInstruments: [],
            },
            pricing: {
              status: 'complete', requestedCount: 1, pricedCount: 1, unpricedCount: 0,
              sources: [{ source: 'coinbase', quality: 'venue_reported_last', pricedCount: 1 }],
            },
          }),
          expect.objectContaining({
            id: PROFILE_ID, isActive: false, status: 'available', schemaVersion: 45,
            tracked: {
              openLotCount: 1, disposalCount: 1, pricedSubtotalUsd: '60',
              completeValueUsd: '60', totalCostUsd: '50', pricedUnrealizedPnlUsd: '10',
              pricedHoldingCount: 1, unpricedHoldingCount: 0, unpricedInstruments: [],
            },
            paper: {
              cashUsd: '500', pricedAssetValueUsd: '0', completeValueUsd: null,
              pricedAssetCount: 0, unpricedAssetCount: 1,
              unpricedInstruments: [instrumentKey(LTC.instrument)],
            },
            pricing: {
              status: 'partial', requestedCount: 2, pricedCount: 1, unpricedCount: 1,
              sources: [{ source: 'coingecko', quality: 'reference_market', pricedCount: 1 }],
            },
          }),
        ],
      },
    });
    expect(prices.spot).toHaveBeenCalledWith([BTC.instrument, ETH.instrument, LTC.instrument]);
    expect(JSON.stringify(result)).not.toContain('wallet-');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.profiles)).toBe(true);
    expect(Object.isFrozen(result.ok && result.value.profiles[0]!.tracked)).toBe(true);
  });

  it('preserves manifest order for explicit selection and rejects invalid selections', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Research' });
    seed(target);
    const service = new AccountsProfileComparisonService({
      clock: { nowMs: () => 10 }, manifestStore: target.manifestStore,
      factsReader: createFileProfileComparisonFactsReader(target.root),
      priceSource: priceSource(), operationGate: target.gate,
    });
    const selected = await service.compare([PROFILE_ID]);
    expect(selected).toEqual({
      ok: true,
      value: expect.objectContaining({
        requestedProfileCount: 1,
        profiles: [expect.objectContaining({ id: PROFILE_ID })],
      }),
    });
    expect(await service.compare([PROFILE_ID, PROFILE_ID])).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_compare_invalid_selection' }],
    });
    expect(await service.compare(['00000000-0000-4000-8000-000000000099'])).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_not_found' }],
    });
  });

  it('reports a missing database as unavailable rather than zero-valued', async () => {
    const target = setup();
    await target.profiles.create({ name: 'Missing' });
    rmSync(join(target.root, `wallet-${PROFILE_ID}.db`), { force: true });
    const service = new AccountsProfileComparisonService({
      clock: { nowMs: () => 10 }, manifestStore: target.manifestStore,
      factsReader: createFileProfileComparisonFactsReader(target.root),
      priceSource: priceSource(), operationGate: target.gate,
    });
    const result = await service.compare();
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        availableProfileCount: 1,
        unavailableProfileCount: 1,
        profiles: [
          expect.objectContaining({ id: 'main', status: 'available' }),
          expect.objectContaining({
            id: PROFILE_ID, status: 'unavailable', reasonCode: 'unavailable',
            tracked: null, paper: null, pricing: null,
          }),
        ],
      }),
    });
  });

  it('caps detached profile reads at four and preserves result ordering', async () => {
    const records = Array.from({ length: 9 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `Profile ${index}`, color: '#60a5fa' as const, icon: 'wallet' as const,
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
    let active = 0;
    let peak = 0;
    const factsReader: ProfileComparisonFactsReader = {
      async read() {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {
          ok: true,
          facts: { schemaVersion: 41, openLots: [], disposalCount: 0, paperBalances: [] },
        };
      },
    };
    const service = new AccountsProfileComparisonService({
      clock: { nowMs: () => 10 }, manifestStore, factsReader,
      priceSource: { name: 'none', spot: vi.fn() },
    });
    const result = await service.compare();
    expect(peak).toBe(4);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        profiles: records.map((record) => expect.objectContaining({ id: record.id })),
      }),
    });
  });

  it('serializes fact capture with profile operations and contains price-source failures', async () => {
    const target = setup();
    const gate = target.gate;
    const reader = createFileProfileComparisonFactsReader(target.root);
    const service = new AccountsProfileComparisonService({
      clock: { nowMs: () => 10 }, manifestStore: target.manifestStore, factsReader: reader,
      priceSource: { name: 'failed', spot: async () => { throw new Error('provider secret'); } },
      operationGate: gate,
    });
    expect(gate.begin()).toBe(true);
    expect(await service.compare()).toEqual({
      ok: false, issues: [{ path: [], code: 'profile_operation_in_progress' }],
    });
    gate.end();
    const database = openDatabase(join(target.root, 'kokintrader.db'));
    insertTaxLots([{
      id: 'lot', asset: BTC, quantity: decimal('1'), remaining: decimal('1'),
      costUsd: decimal('10'), acquiredAt: 1, source: 'manual', externalId: null,
    }], database);
    database.close();
    const result = await service.compare();
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        pricing: expect.objectContaining({ status: 'failed' }),
        profiles: [expect.objectContaining({
          status: 'available',
          tracked: expect.objectContaining({ completeValueUsd: null, pricedSubtotalUsd: '0' }),
          pricing: expect.objectContaining({ status: 'failed' }),
        })],
      }),
    });
    expect(JSON.stringify(result)).not.toContain('provider secret');
  });
});
