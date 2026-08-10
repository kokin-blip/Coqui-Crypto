import { describe, expect, it } from 'vitest';

import {
  decimal,
  nonNegativeDecimal,
  type AssetRef,
  type Disposal,
  type TaxLot,
} from '@coqui/core';
import {
  getAllocationPolicy,
  getSetting,
  insertDisposals,
  insertTaxLots,
  listDisposals,
  listPortfolioMigrationExceptions,
  listPortfolioSnapshots,
  listTaxLots,
  migrations,
  openDatabase,
  replaceTaxLotsBySource,
  runMigrations,
  saveAllocationPolicy,
  savePortfolioSnapshot,
  setSetting,
  updateTaxLotRemaining,
} from '../packages/storage/src/index.js';

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};

const WBTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'WBTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'Wrapped Bitcoin',
  baseAsset: 'WBTC',
  quoteAsset: 'USD',
  coingeckoId: 'wrapped-bitcoin',
};

function lot(id: string, asset = BTC): TaxLot {
  return {
    id,
    asset,
    quantity: nonNegativeDecimal('0.123456789123456789'),
    remaining: nonNegativeDecimal('0.123456789123456789'),
    costUsd: nonNegativeDecimal('12345.6789123456789'),
    acquiredAt: 100,
    source: 'manual',
    externalId: null,
  };
}

describe('canonical decimal portfolio repository', () => {
  it('round-trips lots exactly and keeps symbol collisions separate', () => {
    const database = openDatabase(':memory:');
    insertTaxLots([lot('btc-lot'), lot('wbtc-lot', WBTC)], database);
    expect(listTaxLots(database)).toEqual([lot('btc-lot'), lot('wbtc-lot', WBTC)]);

    expect(updateTaxLotRemaining('btc-lot', '0.000000000000000001', database)).toBe(true);
    expect(listTaxLots(database).find((stored) => stored.id === 'btc-lot')?.remaining)
      .toBe('0.000000000000000001');
    database.close();
  });

  it('rolls back an invalid source replacement instead of losing existing lots', () => {
    const database = openDatabase(':memory:');
    insertTaxLots([lot('preserved')], database);
    const invalid = {
      ...lot('invalid'),
      quantity: 'not-a-decimal',
    } as unknown as TaxLot;

    expect(() => replaceTaxLotsBySource('manual', [invalid], database))
      .toThrow('Expected a non-negative decimal string');
    expect(listTaxLots(database).map((stored) => stored.id)).toEqual(['preserved']);
    database.close();
  });

  it('round-trips signed disposal P&L and observed snapshots as decimal text', () => {
    const database = openDatabase(':memory:');
    const disposal: Disposal = {
      id: 'disposal-1',
      asset: BTC,
      quantity: nonNegativeDecimal('0.1'),
      proceedsUsd: nonNegativeDecimal('9000.000000000000001'),
      costBasisUsd: nonNegativeDecimal('10000'),
      realizedPnlUsd: decimal('-999.999999999999999'),
      longTerm: false,
      disposedAt: 200,
      method: 'fifo',
      source: 'manual',
    };
    insertDisposals([disposal], database);
    expect(listDisposals(database, BTC.instrument)).toEqual([disposal]);

    savePortfolioSnapshot({
      at: 86_400_123,
      valueUsd: nonNegativeDecimal('50000.000000000000001'),
      costUsd: nonNegativeDecimal('40000.000000000000002'),
      realizedPnlUsd: decimal('-1.000000000000003'),
    }, database);
    expect(listPortfolioSnapshots(database)).toEqual([{
      at: 86_400_000,
      valueUsd: '50000.000000000000001',
      costUsd: '40000.000000000000002',
      realizedPnlUsd: '-1.000000000000003',
    }]);
    database.close();
  });

  it('stores allocation targets by canonical identity rather than symbol', () => {
    const database = openDatabase(':memory:');
    saveAllocationPolicy({
      targets: [
        { instrument: BTC.instrument, weight: 0.7 },
        { instrument: WBTC.instrument, weight: 0.3 },
      ],
      rebalanceBandPct: 4,
    }, database);
    expect(getAllocationPolicy(database)).toEqual({
      targets: [
        { instrument: BTC.instrument, weight: 0.7 },
        { instrument: WBTC.instrument, weight: 0.3 },
      ],
      rebalanceBandPct: 4,
    });
    database.close();
  });
});

describe('legacy portfolio isolation', () => {
  it('preserves REAL-valued legacy rows and creates unresolved exceptions', () => {
    const database = openDatabase(':memory:', { migrations: migrations.slice(0, 28) });
    database.prepare(`
      INSERT INTO tax_lots (
        id, asset_id, asset_symbol, asset_name, coinbase_product_id,
        coingecko_id, quantity, remaining, cost_usd, acquired_at, source, external_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-lot', 'bitcoin', 'BTC', 'Bitcoin', 'BTC-USD', 'bitcoin', 1, 1, 10, 1, 'manual', null);

    expect(runMigrations(database)).toBe(37);
    expect(database.prepare('SELECT id FROM tax_lots WHERE id = ?').get('legacy-lot'))
      .toEqual({ id: 'legacy-lot' });
    expect(listTaxLots(database)).toEqual([]);
    expect(listPortfolioMigrationExceptions(database)).toEqual([
      expect.objectContaining({
        id: 'tax_lots:legacy-lot',
        legacyTable: 'tax_lots',
        legacyId: 'legacy-lot',
        resolvedAt: null,
      }),
    ]);
    database.close();
  });

  it('binds setting values instead of interpolating them into SQL', () => {
    const database = openDatabase(':memory:');
    const value = "value'); DROP TABLE app_settings; --";
    setSetting('safe', value, database);
    expect(getSetting('safe', database)).toBe(value);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'app_settings'").get())
      .toEqual({ name: 'app_settings' });
    database.close();
  });
});
