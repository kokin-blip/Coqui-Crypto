import { describe, expect, it } from 'vitest';

import {
  buildCsvImportPlan,
  parsePortfolioCsv,
  type AssetQuantity,
  type AssetRef,
  type CsvAssetResolver,
  type CsvInstrumentResolver,
  type TaxLot,
  type UsdAmount,
} from '../packages/core/src/index.js';

const resolveInstrument: CsvInstrumentResolver = (symbol) =>
  ['BTC', 'ETH', 'SOL'].includes(symbol)
    ? { venue: 'coinbase', productId: `${symbol}-USD`, productType: 'spot' }
    : null;

const resolveAsset: CsvAssetResolver = (instrument, symbol) => ({
  instrument,
  symbol,
  name: symbol,
  baseAsset: symbol,
  quoteAsset: 'USD',
  coingeckoId: null,
});

function parse(csv: string) {
  return parsePortfolioCsv(csv, resolveInstrument);
}

function plan(
  csv: string,
  openLots: readonly TaxLot[] = [],
  seen: ReadonlySet<string> = new Set(),
) {
  return buildCsvImportPlan(parse(csv).trades, openLots, seen, 'fifo', resolveAsset);
}

const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'BTC',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: null,
};

describe('a reward is an acquisition with a real basis', () => {
  it('imports a staking reward as a lot', () => {
    const csv = [
      'Date,Type,Asset,Quantity Transacted,Total USD',
      '2024-03-01,Staking Income,ETH,0.5,1500',
    ].join('\n');

    const result = plan(csv);
    expect(result.newLotCount).toBe(1);
    // Fair market value at receipt is the basis. Dropping the row, as the
    // earlier port did, leaves the asset with no lot behind it — which later
    // surfaces either as an unresolvable exception or a disposal with no basis.
    expect(result.updatedOpenLots[0]?.costUsd).toBe('1500');
  });

  it('derives the value from a spot price when the export carries no total', () => {
    const csv = [
      'Date,Type,Asset,Quantity Transacted,Spot Price at Transaction',
      '2024-03-01,Reward,ETH,0.5,3000',
    ].join('\n');

    // Multiplied in Decimal, never float: this number becomes a cost basis.
    expect(plan(csv).updatedOpenLots[0]?.costUsd).toBe('1500');
  });

  it('still refuses a reward row it cannot value', () => {
    const csv = ['Date,Type,Asset,Quantity Transacted', '2024-03-01,Reward,ETH,0.5'].join('\n');
    expect(parse(csv).trades).toHaveLength(0);
    expect(parse(csv).skipped[0]?.reason).toContain('USD');
  });
});

describe('re-importing the same export changes nothing', () => {
  const csv = [
    'Date,Type,Symbol,Quantity,Total USD',
    '2024-01-01,Buy,BTC,0.2,8000',
    '2024-02-01,Buy,BTC,0.1,4000',
  ].join('\n');

  it('skips rows already imported', () => {
    const first = plan(csv);
    expect(first.newLotCount).toBe(2);

    const second = plan(csv, first.updatedOpenLots, new Set(first.importedFingerprints));
    // A duplicated lot is a fabricated cost basis — the same class of defect
    // invariant 12 forbids reconciliation from committing.
    expect(second.newLotCount).toBe(0);
    expect(second.skipped.map((entry) => entry.reason)).toEqual([
      'Already imported in a previous run (duplicate skipped).',
      'Already imported in a previous run (duplicate skipped).',
    ]);
  });

  it('keeps two genuinely identical trades distinct', () => {
    const twice = [
      'Date,Type,Symbol,Quantity,Total USD',
      '2024-01-01,Buy,BTC,0.2,8000',
      '2024-01-01,Buy,BTC,0.2,8000',
    ].join('\n');

    const trades = parse(twice).trades;
    expect(new Set(trades.map((trade) => trade.fingerprint)).size).toBe(2);
    expect(trades[1]?.fingerprint).toMatch(/#2$/);
    expect(plan(twice).newLotCount).toBe(2);
  });

  it('produces the same lot id on a re-run', () => {
    // Derived from the fingerprint rather than random, so core stays pure and a
    // repeated import cannot mint a second lot for the same trade.
    expect(plan(csv).updatedOpenLots[0]?.id).toBe(plan(csv).updatedOpenLots[0]?.id);
  });
});

describe('a sell never invents the basis it is missing', () => {
  const openLots: readonly TaxLot[] = [{
    id: 'existing',
    asset: BTC,
    quantity: '0.1' as AssetQuantity,
    remaining: '0.1' as AssetQuantity,
    costUsd: '3000' as UsdAmount,
    acquiredAt: Date.UTC(2023, 0, 1),
    source: 'manual',
    externalId: null,
  }];

  it('imports the covered portion and reports the shortfall', () => {
    const csv = ['Date,Type,Symbol,Quantity,Total USD', '2024-01-01,Sell,BTC,0.4,20000'].join('\n');

    const result = plan(csv, openLots);
    expect(result.newDisposals).toHaveLength(1);
    // Covering the rest would mean inventing a lot, which invariant 12 forbids
    // outright — so the gap is reported instead of filled.
    expect(result.skipped[0]?.reason).toContain('exceeded open BTC lots');
    expect(result.deletedLotIds).toEqual(['existing']);
  });

  it('creates no lot for a sell', () => {
    const csv = ['Date,Type,Symbol,Quantity,Total USD', '2024-01-01,Sell,BTC,0.05,2500'].join('\n');
    expect(plan(csv, openLots).newLotCount).toBe(0);
  });
});

describe('real exports, with their preambles', () => {
  it('finds the header under a Coinbase report preamble', () => {
    const csv = [
      'Transactions',
      'User,Erick,erick@example.com',
      '',
      'Timestamp,Transaction Type,Asset,Quantity Transacted,Total (inclusive of fees)',
      '2024-01-01T00:00:00Z,Buy,BTC,0.2,8000',
    ].join('\n');

    // Treating row 1 as the header rejects the whole file, which is how a
    // perfectly good export reads as corrupt.
    const result = parse(csv);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.symbol).toBe('BTC');
  });

  it('reads a header behind a byte-order mark', () => {
    const csv = '﻿Date,Type,Symbol,Quantity,Total USD\n2024-01-01,Buy,BTC,0.2,8000';
    expect(parse(csv).trades).toHaveLength(1);
  });

  it('says why a transfer was not imported', () => {
    const csv = [
      'Date,Type,Symbol,Quantity,Total USD',
      '2024-01-01,Receive,BTC,0.2,8000',
    ].join('\n');

    // "Unsupported" reads as a bug. Naming transfers tells the user the file
    // was understood and the row was deliberately left alone.
    expect(parse(csv).skipped[0]?.reason).toContain('Transfers and converts are not imported');
  });
});
