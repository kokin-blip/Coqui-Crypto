import { describe, expect, it } from 'vitest';

import {
  decimal,
  FixedClock,
  nonNegativeDecimal,
  type AssetRef,
  type Disposal,
  type TaxLot,
} from '@coqui/core';
import { PortfolioTaxService } from '@coqui/services';
import {
  commitPortfolioSale,
  insertDisposals,
  insertTaxLots,
  listDisposals,
  listTaxLots,
  openDatabase,
} from '@coqui/storage';

const DAY = 86_400_000;
const YEAR = 365 * DAY;
const NOW = Date.UTC(2026, 7, 9);

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};

function lot(id: string, quantity: string, costUsd: string, acquiredAt: number): TaxLot {
  return {
    id,
    asset: BTC,
    quantity: nonNegativeDecimal(quantity),
    remaining: nonNegativeDecimal(quantity),
    costUsd: nonNegativeDecimal(costUsd),
    acquiredAt,
    source: 'manual',
    externalId: null,
  };
}

function disposal(id: string): Disposal {
  return {
    id,
    asset: BTC,
    quantity: nonNegativeDecimal('1'),
    proceedsUsd: nonNegativeDecimal('300'),
    costBasisUsd: nonNegativeDecimal('100'),
    realizedPnlUsd: decimal('200'),
    longTerm: true,
    disposedAt: NOW,
    method: 'fifo',
    source: 'manual',
  };
}

function service() {
  const database = openDatabase(':memory:');
  const clock = new FixedClock(NOW);
  return {
    database,
    clock,
    tax: new PortfolioTaxService({ database, clock }),
  };
}

describe('portfolio tax service', () => {
  it('records an exact sale atomically and preserves consumed acquisitions at zero', () => {
    const context = service();
    insertTaxLots([
      lot('long-cheap', '1', '100', NOW - 2 * YEAR),
      lot('short-pricey', '2', '400', NOW - DAY),
    ], context.database);

    const result = context.tax.recordSale({
      instrument: BTC.instrument,
      quantity: '1.5',
      proceedsUsd: '450',
      method: 'fifo',
    });

    expect(result).toMatchObject({
      ok: true,
      disposals: [
        {
          quantity: '0.5',
          proceedsUsd: '150',
          costBasisUsd: '100',
          realizedPnlUsd: '50',
          longTerm: false,
          disposedAt: NOW,
          source: 'manual',
        },
        {
          quantity: '1',
          proceedsUsd: '300',
          costBasisUsd: '100',
          realizedPnlUsd: '200',
          longTerm: true,
          disposedAt: NOW,
          source: 'manual',
        },
      ],
      tax: {
        asOfMs: NOW,
        summary: {
          ytdRealizedUsd: '250',
          allTimeRealizedUsd: '250',
          shortTermRealizedUsd: '50',
          longTermRealizedUsd: '200',
          disposalCount: 2,
        },
        years: [2026],
      },
    });
    expect(listTaxLots(context.database).map(({ id, remaining }) => ({ id, remaining })))
      .toEqual([
        { id: 'long-cheap', remaining: '0' },
        { id: 'short-pricey', remaining: '1.5' },
      ]);
    expect(listDisposals(context.database)).toHaveLength(2);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.disposals)).toBe(true);
      expect(Object.isFrozen(result.disposals[0]?.asset.instrument)).toBe(true);
      expect(Object.isFrozen(result.tax.summary)).toBe(true);
    }
    context.database.close();
  });

  it('rejects shortfall and future acquisitions without mutating the ledger', () => {
    const context = service();
    insertTaxLots([
      lot('available', '1', '100', NOW - DAY),
      lot('not-yet-acquired', '10', '1000', NOW + DAY),
    ], context.database);
    const before = listTaxLots(context.database);

    expect(context.tax.recordSale({
      instrument: BTC.instrument,
      quantity: '2',
      proceedsUsd: '400',
      method: 'fifo',
      disposedAt: NOW,
    })).toEqual({
      ok: false,
      reasonCode: 'insufficient_quantity',
      shortfall: '1',
    });
    expect(listTaxLots(context.database)).toEqual(before);
    expect(listDisposals(context.database)).toEqual([]);
    context.database.close();
  });

  it('returns stable validation failures before changing storage', () => {
    const context = service();
    insertTaxLots([lot('preserved', '1', '100', NOW - DAY)], context.database);
    const base = {
      instrument: BTC.instrument,
      quantity: '1',
      proceedsUsd: '200',
      method: 'fifo' as const,
    };

    expect(context.tax.recordSale({ ...base, quantity: '0' }))
      .toEqual({ ok: false, reasonCode: 'invalid_quantity' });
    expect(context.tax.recordSale({ ...base, proceedsUsd: '-1' }))
      .toEqual({ ok: false, reasonCode: 'invalid_proceeds' });
    expect(context.tax.recordSale({ ...base, method: 'unknown' as 'fifo' }))
      .toEqual({ ok: false, reasonCode: 'invalid_method' });
    expect(context.tax.recordSale({ ...base, disposedAt: NOW + 1 }))
      .toEqual({ ok: false, reasonCode: 'invalid_disposed_at' });
    expect(context.tax.recordSale({
      ...base,
      instrument: { venue: 'binance', productId: 'BTCUSDT', productType: 'spot' },
    })).toEqual({ ok: false, reasonCode: 'invalid_instrument' });
    expect(listTaxLots(context.database)[0]?.remaining).toBe('1');
    expect(listDisposals(context.database)).toEqual([]);
    context.database.close();
  });

  it('rolls back lot changes when deterministic disposal evidence already exists', () => {
    const context = service();
    insertTaxLots([lot('preserved', '1', '100', NOW - 2 * YEAR)], context.database);
    const conflictId = `coinbase|spot|BTC-USD-${NOW}-long`;
    insertDisposals([disposal(conflictId)], context.database);

    expect(context.tax.recordSale({
      instrument: BTC.instrument,
      quantity: '1',
      proceedsUsd: '300',
      method: 'fifo',
    })).toEqual({ ok: false, reasonCode: 'disposal_id_conflict' });
    expect(listTaxLots(context.database)[0]?.remaining).toBe('1');
    expect(listDisposals(context.database)).toEqual([disposal(conflictId)]);
    context.database.close();
  });

  it('previews every method immutably without changing lots or disposal evidence', () => {
    const context = service();
    insertTaxLots([
      lot('long-cheap', '1', '100', NOW - 2 * YEAR),
      lot('short-pricey', '1', '200', NOW - DAY),
    ], context.database);
    const before = listTaxLots(context.database);
    const result = context.tax.previewSale({
      instrument: BTC.instrument,
      quantity: '1',
      proceedsUsd: '300',
      method: 'fifo',
      rates: { shortTermPct: 24, longTermPct: 15 },
    });

    expect(result).toMatchObject({
      ok: true,
      asOfMs: NOW,
      rates: { shortTermPct: 24, longTermPct: 15 },
      comparison: {
        currentMethod: 'fifo',
        previews: expect.arrayContaining([
          expect.objectContaining({ method: 'fifo', longTermGainUsd: '200', estTaxUsd: '30' }),
          expect.objectContaining({ method: 'lifo', shortTermGainUsd: '100', estTaxUsd: '24' }),
        ]),
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.comparison.previews)).toBe(true);
    expect(listTaxLots(context.database)).toEqual(before);
    expect(listDisposals(context.database)).toEqual([]);

    expect(context.tax.previewSale({
      instrument: BTC.instrument,
      quantity: '1',
      proceedsUsd: '300',
      method: 'fifo',
      rates: { shortTermPct: 101, longTermPct: 15 },
    })).toEqual({ ok: false, reasonCode: 'invalid_tax_rates' });
    context.database.close();
  });

  it('rolls back earlier lot updates when a later persistence reference is missing', () => {
    const database = openDatabase(':memory:');
    insertTaxLots([lot('preserved', '2', '100', NOW - DAY)], database);
    expect(() => commitPortfolioSale(
      [
        { id: 'preserved', remaining: '1' },
        { id: 'missing', remaining: '0' },
      ],
      [disposal('new-disposal')],
      database,
    )).toThrow('referenced a missing tax lot');
    expect(listTaxLots(database)[0]?.remaining).toBe('2');
    expect(listDisposals(database)).toEqual([]);
    database.close();
  });
});
