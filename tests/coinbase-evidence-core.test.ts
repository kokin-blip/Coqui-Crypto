import { describe, expect, it } from 'vitest';

import {
  coinbaseEvidenceDatasetHash,
  coinbaseLocalBalancesFromLots,
  decimal,
  reconcileCoinbaseBalances,
  type AssetRef,
  type CoinbaseAccountEvidence,
  type CoinbaseFillEvidence,
  type TaxLot,
} from '../packages/core/src/index.js';

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC', name: 'Bitcoin', baseAsset: 'BTC', quoteAsset: 'USD', coingeckoId: 'bitcoin',
};

function lot(id: string, remaining: string): TaxLot {
  return {
    id, asset: BTC, quantity: decimal(remaining), remaining: decimal(remaining),
    costUsd: decimal('1'), acquiredAt: 1, source: 'manual', externalId: null,
  };
}

function account(currency: string, total: string): CoinbaseAccountEvidence {
  return {
    accountUuid: `${currency.toLowerCase()}-account`, currency,
    availableQuantity: decimal(total), holdQuantity: decimal('0'),
    totalQuantity: decimal(total), active: true, ready: true,
    defaultAccount: false, providerUpdatedAtMs: null,
  };
}

function fill(tradeId: string, sequenceAtMs: number): CoinbaseFillEvidence {
  return {
    tradeId, orderId: `order-${tradeId}`, productId: 'BTC-USD', side: 'BUY',
    price: decimal('50000.00000001'), size: decimal('0.1'), commission: decimal('1.23'),
    sizeInQuote: false, tradeAtMs: 100, sequenceAtMs,
  };
}

describe('Coinbase evidence domain', () => {
  it('aggregates local remaining quantities exactly and returns immutable canonical order', () => {
    const balances = coinbaseLocalBalancesFromLots([
      lot('a', '0.100000000000000001'),
      lot('b', '0.200000000000000002'),
      lot('zero', '0'),
    ]);
    expect(balances).toEqual([{ currency: 'BTC', quantity: '0.300000000000000003' }]);
    expect(Object.isFrozen(balances)).toBe(true);
    expect(Object.isFrozen(balances[0])).toBe(true);
  });

  it('reports deterministic directional discrepancies without inventing a resolution', () => {
    const result = reconcileCoinbaseBalances(
      [account('ETH', '2'), account('BTC', '1.000000000000000002')],
      [
        { currency: 'BTC', quantity: decimal('1.000000000000000001') },
        { currency: 'SOL', quantity: decimal('3') },
      ],
    );
    expect(result).toEqual([
      {
        currency: 'BTC', kind: 'provider_exceeds_local',
        providerQuantity: '1.000000000000000002',
        localQuantity: '1.000000000000000001', deltaQuantity: '0.000000000000000001',
      },
      {
        currency: 'ETH', kind: 'provider_exceeds_local',
        providerQuantity: '2', localQuantity: '0', deltaQuantity: '2',
      },
      {
        currency: 'SOL', kind: 'local_exceeds_provider',
        providerQuantity: '0', localQuantity: '3', deltaQuantity: '3',
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('hashes normalized facts independently of provider page order', () => {
    const accounts = [account('BTC', '1'), account('ETH', '2')];
    const fills = [fill('second', 2), fill('first', 1)];
    const hash = coinbaseEvidenceDatasetHash(accounts, fills);
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(coinbaseEvidenceDatasetHash([...accounts].reverse(), [...fills].reverse())).toBe(hash);
    expect(coinbaseEvidenceDatasetHash(accounts, [fill('changed', 1)])).not.toBe(hash);
  });
});
