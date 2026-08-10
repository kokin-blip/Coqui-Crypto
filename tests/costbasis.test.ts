import { describe, expect, it } from 'vitest';
import {
  decimal,
  disposeLots,
  lotFromReversedDisposal,
  type AssetRef,
  type Disposal,
  type TaxLot,
} from '../packages/core/src/index.js';

const YEAR = 365 * 24 * 60 * 60 * 1_000;
const NOW = 2_000_000_000_000;

function asset(id: string): AssetRef {
  return {
    instrument: { venue: 'coinbase', productId: `${id}-USD`, productType: 'spot' },
    symbol: id,
    name: id,
    baseAsset: id,
    quoteAsset: 'USD',
    coingeckoId: id.toLowerCase(),
  };
}

function lot(
  id: string,
  assetId: string,
  quantity: string,
  costUsd: string,
  acquiredAt: number,
  remaining = quantity,
): TaxLot {
  return {
    id,
    asset: asset(assetId),
    quantity: decimal(quantity),
    remaining: decimal(remaining),
    costUsd: decimal(costUsd),
    acquiredAt,
    source: 'manual',
    externalId: null,
  };
}

const lotA = () => lot('A', 'BTC', '1', '10000', NOW - 2 * YEAR);
const lotB = () => lot('B', 'BTC', '1', '20000', NOW - 30 * 24 * 60 * 60 * 1_000);

describe('lotFromReversedDisposal', () => {
  function disposal(overrides: Partial<Disposal> = {}): Disposal {
    return {
      id: 'btc-short',
      asset: asset('BTC'),
      quantity: decimal('0.5'),
      proceedsUsd: decimal('15000'),
      costBasisUsd: decimal('8000'),
      realizedPnlUsd: decimal('7000'),
      longTerm: false,
      disposedAt: NOW,
      method: 'fifo',
      source: 'manual',
      ...overrides,
    };
  }

  it('restores only the disposal quantity and cost basis', () => {
    const restored = lotFromReversedDisposal(disposal(), 'new-id');
    expect(restored).toMatchObject({
      id: 'new-id',
      quantity: '0.5',
      remaining: '0.5',
      costUsd: '8000',
      source: 'manual',
      externalId: null,
    });
  });

  it('preserves the recorded holding-period class when reversed', () => {
    const long = lotFromReversedDisposal(disposal({ longTerm: true }), 'long');
    expect(NOW - long.acquiredAt).toBeGreaterThan(YEAR);
    expect(
      disposeLots(
        [long],
        asset('BTC').instrument,
        decimal('0.5'),
        decimal('100'),
        'fifo',
        NOW,
      ).disposals[0]?.longTerm,
    ).toBe(true);
    expect(lotFromReversedDisposal(disposal(), 'short').acquiredAt).toBe(NOW);
  });
});

describe('disposeLots', () => {
  it('preserves FIFO, LIFO, HIFO, and average cost behavior', () => {
    const fifo = disposeLots(
      [lotA(), lotB()],
      asset('BTC').instrument,
      decimal('1'),
      decimal('30000'),
      'fifo',
      NOW,
    );
    expect(fifo.disposals[0]).toMatchObject({
      quantity: '1',
      costBasisUsd: '10000',
      realizedPnlUsd: '20000',
      longTerm: true,
    });
    expect(fifo.updatedLots.map((openLot) => openLot.id)).toEqual(['B']);

    const lifo = disposeLots(
      [lotA(), lotB()],
      asset('BTC').instrument,
      decimal('1'),
      decimal('30000'),
      'lifo',
      NOW,
    );
    expect(lifo.disposals[0]).toMatchObject({
      costBasisUsd: '20000',
      realizedPnlUsd: '10000',
      longTerm: false,
    });
    expect(lifo.updatedLots.map((openLot) => openLot.id)).toEqual(['A']);

    const hifo = disposeLots(
      [lotA(), lotB()],
      asset('BTC').instrument,
      decimal('1'),
      decimal('30000'),
      'hifo',
      NOW,
    );
    expect(hifo.disposals[0]?.costBasisUsd).toBe('20000');

    const average = disposeLots(
      [lotA(), lotB()],
      asset('BTC').instrument,
      decimal('1'),
      decimal('30000'),
      'average',
      NOW,
    );
    expect(average.disposals[0]).toMatchObject({
      costBasisUsd: '15000',
      realizedPnlUsd: '15000',
    });
  });

  it('splits proceeds exactly across short- and long-term buckets', () => {
    const result = disposeLots(
      [lotA(), lotB()],
      asset('BTC').instrument,
      decimal('2'),
      decimal('60000'),
      'fifo',
      NOW,
      'coinbase',
    );
    expect(result.shortfall).toBe('0');
    expect(result.updatedLots).toHaveLength(0);
    expect(result.disposals.find((item) => item.longTerm)).toMatchObject({
      quantity: '1',
      costBasisUsd: '10000',
      proceedsUsd: '30000',
      realizedPnlUsd: '20000',
      source: 'coinbase',
    });
    expect(result.disposals.find((item) => !item.longTerm)).toMatchObject({
      quantity: '1',
      costBasisUsd: '20000',
      proceedsUsd: '30000',
      realizedPnlUsd: '10000',
    });
  });

  it('treats exactly one year as short-term', () => {
    const exact = lot('E', 'BTC', '1', '100', NOW - YEAR);
    const over = lot('O', 'BTC', '1', '100', NOW - YEAR - 1);
    expect(
      disposeLots(
        [exact],
        asset('BTC').instrument,
        decimal('1'),
        decimal('200'),
        'fifo',
        NOW,
      ).disposals[0]?.longTerm,
    ).toBe(false);
    expect(
      disposeLots(
        [over],
        asset('BTC').instrument,
        decimal('1'),
        decimal('200'),
        'fifo',
        NOW,
      ).disposals[0]?.longTerm,
    ).toBe(true);
  });

  it('partially consumes, reports shortfall, and preserves other instruments', () => {
    const eth = lot('ETH', 'ETH', '5', '5000', NOW - 2 * YEAR);
    const result = disposeLots(
      [lotA(), eth],
      asset('BTC').instrument,
      decimal('3'),
      decimal('90000'),
      'fifo',
      NOW,
    );
    expect(result.shortfall).toBe('2');
    expect(result.disposals[0]?.quantity).toBe('1');
    expect(result.updatedLots).toEqual([eth]);

    const partial = disposeLots(
      [lot('C', 'ETH', '10', '1000', NOW - 2 * YEAR)],
      asset('ETH').instrument,
      decimal('3'),
      decimal('600'),
      'fifo',
      NOW,
    );
    expect(partial.disposals[0]).toMatchObject({ costBasisUsd: '300', realizedPnlUsd: '300' });
    expect(partial.updatedLots[0]?.remaining).toBe('7');
  });

  it('does nothing for zero quantity or a nonmatching canonical instrument', () => {
    expect(
      disposeLots(
        [lotA()],
        asset('BTC').instrument,
        decimal('0'),
        decimal('0'),
        'fifo',
        NOW,
      ).disposals,
    ).toEqual([]);
    expect(
      disposeLots(
        [lotA()],
        asset('SOL').instrument,
        decimal('1'),
        decimal('100'),
        'fifo',
        NOW,
      ).shortfall,
    ).toBe('1');
  });
});
