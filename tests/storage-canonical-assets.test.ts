import { describe, expect, it } from 'vitest';

import type { InstrumentIdentity } from '@coqui/core';
import {
  listCanonicalMappingExceptions,
  listInstrumentProviderMappings,
  migrations,
  openDatabase,
  resolveVerifiedProviderInstrument,
  runMigrations,
  upsertInstrumentProviderMapping,
} from '../packages/storage/src/index.js';

const btc: InstrumentIdentity = {
  venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
};
const wbtc: InstrumentIdentity = {
  venue: 'coinbase', productId: 'WBTC-USD', productType: 'spot',
};

function canonical(instrument: InstrumentIdentity) {
  return {
    instrument, symbol: 'BTC', name: instrument.productId === 'BTC-USD' ? 'Bitcoin' : 'Wrapped Bitcoin',
    baseAsset: instrument.productId.split('-')[0]!, quoteAsset: 'USD',
  };
}

describe('canonical provider mapping repository', () => {
  it('resolves only verified mappings and keeps display-symbol collisions separate', () => {
    const database = openDatabase(':memory:');
    upsertInstrumentProviderMapping(canonical(btc), {
      provider: 'coingecko', providerAssetId: 'bitcoin', status: 'verified',
      platform: null, network: null, contractAddress: null,
      evidenceJson: '{"method":"coinbase-product-and-provider-id"}',
    }, 100, database);
    upsertInstrumentProviderMapping(canonical(wbtc), {
      provider: 'coinmarketcap', providerAssetId: '3717', status: 'ambiguous',
      platform: 'ethereum', network: 'ethereum', contractAddress: '0xwbtc',
      evidenceJson: '{"requiresManualReview":true}',
    }, 101, database);

    expect(resolveVerifiedProviderInstrument('coingecko', 'bitcoin', database)).toEqual(btc);
    expect(resolveVerifiedProviderInstrument('coinmarketcap', '3717', database)).toBeNull();
    expect(listInstrumentProviderMappings(btc, database)).toHaveLength(1);
    expect(listInstrumentProviderMappings(wbtc, database)).toHaveLength(1);
    database.close();
  });

  it('rejects silent provider-id remapping and rolls back the new instrument', () => {
    const database = openDatabase(':memory:');
    const mapping = {
      provider: 'coinpaprika' as const, providerAssetId: 'btc-bitcoin',
      status: 'verified' as const, platform: null, network: null, contractAddress: null,
      evidenceJson: '{"source":"provider-api"}',
    };
    upsertInstrumentProviderMapping(canonical(btc), mapping, 100, database);
    expect(() => upsertInstrumentProviderMapping(canonical(wbtc), mapping, 101, database))
      .toThrow('cannot be silently remapped');
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM canonical_instruments WHERE product_id = 'WBTC-USD'",
    ).get()).toEqual({ count: 0 });
    database.close();
  });

  it('isolates legacy symbol-era rows as explicit migration exceptions', () => {
    const database = openDatabase(':memory:', { migrations: migrations.slice(0, 30) });
    database.prepare(
      `INSERT INTO canonical_assets (id, symbol, name, created_at, updated_at)
       VALUES ('legacy-btc', 'BTC', 'Bitcoin', 1, 2)`,
    ).run();
    database.prepare(
      `INSERT INTO asset_provider_mappings
       (provider, provider_asset_id, canonical_asset_id, status, updated_at)
       VALUES ('coingecko', 'bitcoin', 'legacy-btc', 'verified', 2)`,
    ).run();
    expect(runMigrations(database)).toBe(36);
    expect(listCanonicalMappingExceptions(database)).toEqual([
      expect.objectContaining({ sourceTable: 'asset_provider_mappings', sourceKey: 'coingecko:bitcoin' }),
      expect.objectContaining({ sourceTable: 'canonical_assets', sourceKey: 'legacy-btc' }),
    ]);
    database.close();
  });
});
