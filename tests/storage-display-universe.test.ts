import { describe, expect, it } from 'vitest';

import {
  createPointInTimeUniverseSnapshot,
  type AssetRef,
  type InstrumentIdentity,
} from '../packages/core/src/index.js';
import {
  listDisplayUniverse,
  listUniverseSnapshots,
  openDatabase,
  readProfileDeletionImpact,
  recordCoinbaseCatalogAssets,
  replaceDisplayUniverse,
  saveUniverseSnapshot,
} from '../packages/storage/src/index.js';

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD', coingeckoId: null,
};
const ETH: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
  symbol: 'ETH', name: 'Ethereum', baseAsset: 'ETH', quoteAsset: 'USD', coingeckoId: null,
};
const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';

function identities(...assets: AssetRef[]): InstrumentIdentity[] {
  return assets.map((asset) => asset.instrument);
}

describe('profile display-universe repository', () => {
  it('retains canonical Coinbase mappings and replaces ordered selection atomically', () => {
    const database = openDatabase(':memory:');
    recordCoinbaseCatalogAssets([BTC, ETH], 10, database);
    const saved = replaceDisplayUniverse(
      'main', identities(ETH, BTC), 20, EVENT_A, database,
    );
    expect(saved.changed).toBe(true);
    expect(saved.assets.map((asset) => asset.instrument.productId)).toEqual(['ETH-USD', 'BTC-USD']);
    expect(saved.selectionHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(listDisplayUniverse('main', database)).toEqual([ETH, BTC]);
    expect(database.prepare(`SELECT status FROM instrument_provider_mappings
      WHERE provider = 'coinbase' AND provider_asset_id = 'BTC-USD'`).get())
      .toEqual({ status: 'verified' });
    expect(readProfileDeletionImpact('main', database).portfolioEvidenceRecords).toBe(3);
    database.close();
  });

  it('is idempotent for the same ordered set and appends only real transitions', () => {
    const database = openDatabase(':memory:');
    recordCoinbaseCatalogAssets([BTC, ETH], 10, database);
    replaceDisplayUniverse('main', identities(BTC, ETH), 20, EVENT_A, database);
    const retry = replaceDisplayUniverse('main', identities(BTC, ETH), 30, EVENT_B, database);
    expect(retry.changed).toBe(false);
    expect(database.prepare('SELECT COUNT(*) AS count FROM display_universe_events_v1').get())
      .toEqual({ count: 1 });
    const cleared = replaceDisplayUniverse('main', [], 40, EVENT_B, database);
    expect(cleared.changed).toBe(true);
    expect(listDisplayUniverse('main', database)).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM display_universe_events_v1').get())
      .toEqual({ count: 2 });
    database.close();
  });

  it('rejects duplicates and unknown identities without changing prior selection', () => {
    const database = openDatabase(':memory:');
    recordCoinbaseCatalogAssets([BTC], 10, database);
    replaceDisplayUniverse('main', identities(BTC), 20, EVENT_A, database);
    expect(() => replaceDisplayUniverse(
      'main', identities(BTC, BTC), 30, EVENT_B, database,
    )).toThrow('duplicates');
    expect(() => replaceDisplayUniverse('main', [{
      venue: 'coinbase', productId: 'MISSING-USD', productType: 'spot',
    }], 30, EVENT_B, database)).toThrow('unknown instrument');
    database.prepare(`INSERT INTO canonical_instruments (
      venue, product_id, product_type, symbol, name, base_asset, quote_asset,
      created_at, updated_at
    ) VALUES ('coinbase', 'SOL-USD', 'spot', 'SOL', 'Solana', 'SOL', 'USD', 1, 1)`).run();
    expect(() => replaceDisplayUniverse('main', [{
      venue: 'coinbase', productId: 'SOL-USD', productType: 'spot',
    }], 30, EVENT_B, database)).toThrow('unknown instrument');
    expect(listDisplayUniverse('main', database)).toEqual([BTC]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM display_universe_events_v1').get())
      .toEqual({ count: 1 });
    database.close();
  });

  it('isolates current selections by profile while retaining immutable event origin', () => {
    const database = openDatabase(':memory:');
    recordCoinbaseCatalogAssets([BTC, ETH], 10, database);
    replaceDisplayUniverse('main', identities(BTC), 20, EVENT_A, database);
    const other = '00000000-0000-4000-8000-000000000001';
    replaceDisplayUniverse(other, identities(ETH), 21, EVENT_B, database);
    expect(listDisplayUniverse('main', database)).toEqual([BTC]);
    expect(listDisplayUniverse(other, database)).toEqual([ETH]);
    expect(database.prepare(`SELECT origin_profile_id FROM display_universe_events_v1
      ORDER BY recorded_at_ms`).all()).toEqual([
      { origin_profile_id: 'main' }, { origin_profile_id: other },
    ]);
    expect(() => database.prepare('DELETE FROM display_universe_events_v1').run())
      .toThrow('immutable');
    database.close();
  });

  it('never mutates the point-in-time research universe', () => {
    const database = openDatabase(':memory:');
    const snapshot = createPointInTimeUniverseSnapshot(Date.UTC(2026, 7, 10, 12), [{
      instrument: BTC.instrument, baseAsset: 'BTC', quoteAsset: 'USD', status: 'online',
      tradingDisabled: false, cancelOnly: false, limitOnly: false, postOnly: false,
      baseIncrement: '0.00000001', quoteIncrement: '0.01', minMarketFunds: '1',
    }]);
    saveUniverseSnapshot(snapshot, database);
    const before = listUniverseSnapshots(database);
    recordCoinbaseCatalogAssets([BTC, ETH], 20, database);
    replaceDisplayUniverse('main', identities(ETH), 30, EVENT_A, database);
    expect(listUniverseSnapshots(database)).toEqual(before);
    database.close();
  });
});
