import { describe, expect, it } from 'vitest';

import type { PaperPortfolioSnapshotV1 } from '../packages/core/src/index.js';
import {
  getPaperBookOrigin,
  initializePaperBook,
  listPaperBalances,
  openDatabase,
} from '../packages/storage/src/index.js';

const PROFILE = 'main';
const ASSET = 'coinbase|spot|BTC-USD';

function snapshot(quantity = '1'): PaperPortfolioSnapshotV1 {
  return {
    schemaVersion: 1,
    profileId: PROFILE,
    source: 'tracked_holdings_opening',
    balances: [{ assetId: ASSET, quantity, priceUsd: '100', valueUsd: quantity === '1' ? '100' : '200' }],
    cashUsd: '0',
    asOfMs: 1_000,
  };
}

describe('paper book origin', () => {
  it('seeds exactly once and preserves the immutable opening snapshot', () => {
    const database = openDatabase(':memory:');
    expect(initializePaperBook(snapshot(), database)).toBe('created');
    expect(initializePaperBook(snapshot(), database)).toBe('exists');
    expect(() => initializePaperBook(snapshot('2'), database)).toThrow(/cannot change/u);
    expect(getPaperBookOrigin(PROFILE, database)?.snapshot).toEqual(snapshot());
    expect(listPaperBalances(PROFILE, database).map(({ assetId, quantity }) => ({ assetId, quantity })))
      .toEqual([
        { assetId: 'USD', quantity: '0' },
        { assetId: ASSET, quantity: '1' },
      ]);
    database.close();
  });

  it('refuses empty, partially priced, and non-zero-cash seeds without partial balances', () => {
    for (const invalid of [
      { ...snapshot(), balances: [] },
      { ...snapshot(), balances: [{ ...snapshot().balances[0]!, priceUsd: '0' }] },
      { ...snapshot(), cashUsd: '1' },
    ]) {
      const database = openDatabase(':memory:');
      expect(() => initializePaperBook(invalid as PaperPortfolioSnapshotV1, database))
        .toThrow(/complete, priced, and use zero cash/u);
      expect(listPaperBalances(PROFILE, database)).toEqual([]);
      database.close();
    }
  });
});
