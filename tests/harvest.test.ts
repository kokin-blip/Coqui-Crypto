import { describe, expect, it } from 'vitest';
import {
  decimal,
  harvestOpportunities,
  instrumentKey,
  type AssetRef,
  type TaxLot,
} from '../packages/core/src/index.js';

const NOW = Date.parse('2026-06-15T00:00:00Z');
const ONE_YEAR = 365 * 24 * 60 * 60 * 1_000;

function asset(id: string): AssetRef {
  return {
    instrument: { venue: 'coinbase', productId: `${id}-USD`, productType: 'spot' },
    symbol: id,
    name: `${id} coin`,
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
): TaxLot {
  return {
    id,
    asset: asset(assetId),
    quantity: decimal(quantity),
    remaining: decimal(quantity),
    costUsd: decimal(costUsd),
    acquiredAt,
    source: 'manual',
    externalId: null,
  };
}

function prices(entries: Array<[string, string]>): Map<ReturnType<typeof instrumentKey>, ReturnType<typeof decimal>> {
  return new Map(entries.map(([id, price]) => [instrumentKey(asset(id).instrument), decimal(price)]));
}

describe('harvestOpportunities', () => {
  it('finds nothing when lots are profitable or unpriced', () => {
    expect(
      harvestOpportunities([lot('1', 'BTC', '1', '50000', NOW)], prices([['BTC', '60000']]), NOW)
        .opportunities,
    ).toEqual([]);
    expect(harvestOpportunities([lot('2', 'XYZ', '1', '100', NOW)], new Map(), NOW).opportunities)
      .toEqual([]);
  });

  it('surfaces exact loss totals keyed by canonical instrument', () => {
    const summary = harvestOpportunities(
      [lot('1', 'BTC', '1', '60000.15', NOW)],
      prices([['BTC', '50000.05']]),
      NOW,
    );
    expect(summary.opportunities[0]).toMatchObject({
      quantity: '1',
      costBasisUsd: '60000.15',
      marketValueUsd: '50000.05',
      unrealizedLossUsd: '-10000.1',
      shortTermLossUsd: '-10000.1',
      longTermLossUsd: '0',
    });
    expect(summary.totalHarvestableLossUsd).toBe('-10000.1');
  });

  it('splits losses at the strict one-year boundary', () => {
    const summary = harvestOpportunities(
      [
        lot('long', 'ETH', '1', '4000', NOW - ONE_YEAR - 1),
        lot('short', 'ETH', '1', '4000', NOW - ONE_YEAR),
      ],
      prices([['ETH', '3000']]),
      NOW,
    );
    expect(summary.opportunities[0]).toMatchObject({
      quantity: '2',
      longTermLossUsd: '-1000',
      shortTermLossUsd: '-1000',
      unrealizedLossUsd: '-2000',
    });
    expect(summary.totalLongTermLossUsd).toBe('-1000');
    expect(summary.totalShortTermLossUsd).toBe('-1000');
  });

  it('includes only losing lots within a mixed position and sorts largest loss first', () => {
    const summary = harvestOpportunities(
      [
        lot('win', 'SOL', '10', '500', NOW),
        lot('lose', 'SOL', '10', '2000', NOW),
        lot('btc', 'BTC', '1', '500', NOW),
      ],
      prices([
        ['SOL', '100'],
        ['BTC', '100'],
      ]),
      NOW,
    );
    expect(summary.opportunities.map((item) => item.asset.symbol)).toEqual(['SOL', 'BTC']);
    expect(summary.opportunities[0]).toMatchObject({ quantity: '10', unrealizedLossUsd: '-1000' });
  });
});
