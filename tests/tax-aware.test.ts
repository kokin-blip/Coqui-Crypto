import { describe, expect, it } from 'vitest';
import {
  compareSaleTax,
  decimal,
  DEFAULT_TAX_RATES,
  previewSaleTax,
  type AssetRef,
  type TaxLot,
} from '../packages/core/src/index.js';

const YEAR = 365 * 24 * 60 * 60 * 1_000;
const NOW = 2_000_000_000_000;

function asset(): AssetRef {
  return {
    instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
    symbol: 'BTC',
    name: 'Bitcoin',
    baseAsset: 'BTC',
    quoteAsset: 'USD',
    coingeckoId: 'bitcoin',
  };
}

function lot(id: string, costUsd: string, acquiredAt: number): TaxLot {
  return {
    id,
    asset: asset(),
    quantity: decimal('1'),
    remaining: decimal('1'),
    costUsd: decimal(costUsd),
    acquiredAt,
    source: 'manual',
    externalId: null,
  };
}

const longCheap = () => lot('A', '10000', NOW - 2 * YEAR);
const shortPricey = () => lot('B', '28000', NOW - 30 * 24 * 60 * 60 * 1_000);

describe('previewSaleTax', () => {
  it('splits gains by term and estimates exact tax', () => {
    const preview = previewSaleTax(
      [longCheap(), shortPricey()],
      asset().instrument,
      decimal('1'),
      decimal('30000'),
      'fifo',
      DEFAULT_TAX_RATES,
      NOW,
    );
    expect(preview).toMatchObject({
      longTermGainUsd: '20000',
      shortTermGainUsd: '0',
      totalGainUsd: '20000',
      estTaxUsd: '3000',
      netProceedsUsd: '27000',
      shortfall: '0',
    });
  });

  it('reports losses as offsets and preserves uncovered quantity', () => {
    const loss = previewSaleTax(
      [shortPricey()],
      asset().instrument,
      decimal('1'),
      decimal('20000'),
      'fifo',
      DEFAULT_TAX_RATES,
      NOW,
    );
    expect(loss.totalGainUsd).toBe('-8000');
    expect(loss.estTaxUsd).toBe('-1920');

    const over = previewSaleTax(
      [shortPricey()],
      asset().instrument,
      decimal('3'),
      decimal('60000'),
      'fifo',
      DEFAULT_TAX_RATES,
      NOW,
    );
    expect(over.shortfall).toBe('2');
  });
});

describe('compareSaleTax', () => {
  it('names the cheapest method and quantifies exact savings', () => {
    const comparison = compareSaleTax(
      [longCheap(), shortPricey()],
      asset().instrument,
      decimal('1'),
      decimal('30000'),
      'fifo',
      DEFAULT_TAX_RATES,
      NOW,
    );
    expect(comparison.previews).toHaveLength(4);
    expect(comparison.cheapest).toBe('lifo');
    expect(comparison.savingsVsCurrentUsd).toBe('2520');
    expect(comparison.note).toContain('LIFO');
    expect(comparison.harvestsLoss).toBe(false);
  });

  it('flags tax-loss harvesting and near-optimal current methods', () => {
    const harvest = compareSaleTax(
      [shortPricey()],
      asset().instrument,
      decimal('1'),
      decimal('20000'),
      'fifo',
      DEFAULT_TAX_RATES,
      NOW,
    );
    expect(harvest.harvestsLoss).toBe(true);
    expect(harvest.note).toContain('tax-loss harvest');

    const optimal = compareSaleTax(
      [longCheap(), shortPricey()],
      asset().instrument,
      decimal('1'),
      decimal('30000'),
      'lifo',
      DEFAULT_TAX_RATES,
      NOW,
    );
    expect(optimal.cheapest).toBe('lifo');
    expect(optimal.savingsVsCurrentUsd).toBe('0');
    expect(optimal.note).toContain('near-)optimal');
  });
});
