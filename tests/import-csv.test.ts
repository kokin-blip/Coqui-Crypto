import { describe, expect, it } from 'vitest';
import { parsePortfolioCsv, type CsvInstrumentResolver } from '../packages/core/src/index.js';

const resolve: CsvInstrumentResolver = (symbol) =>
  ['BTC', 'ETH', 'SOL'].includes(symbol)
    ? { venue: 'coinbase', productId: `${symbol}-USD`, productType: 'spot' }
    : null;

describe('parsePortfolioCsv', () => {
  it('parses canonical decimal buy/sell rows and sorts them by date', () => {
    const csv = [
      'Date,Type,Symbol,Quantity,Total USD',
      '2024-02-01,Sell,BTC,0.1,5000.25',
      '2024-01-01,Buy,BTC,0.2,8000.10',
    ].join('\n');
    const result = parsePortfolioCsv(csv, resolve);
    expect(result.skipped).toEqual([]);
    expect(result.trades.map((trade) => trade.action)).toEqual(['buy', 'sell']);
    expect(result.trades[0]).toMatchObject({
      quantity: '0.2',
      usd: '8000.1',
      instrument: { productId: 'BTC-USD' },
    });
  });

  it('handles quoted cells containing commas', () => {
    const csv =
      'Timestamp,Transaction Type,Asset,Quantity Transacted,Total\n"Jan 1, 2024",Buy,ETH,2,"$4,200.00"';
    const result = parsePortfolioCsv(csv, resolve);
    expect(result.trades[0]).toMatchObject({ symbol: 'ETH', quantity: '2', usd: '4200' });
  });

  it('skips unsupported, malformed, unresolved, and negative rows without failing the file', () => {
    const csv = [
      'Date,Type,Symbol,Quantity,Total USD',
      '2024-01-01,Transfer,BTC,1,100',
      '2024-01-02,Buy,,1,100',
      '2024-01-03,Buy,DOGE,2,50',
      '2024-01-04,Buy,SOL,-2,50',
      '2024-01-05,Buy,SOL,2,-50',
      '2024-01-06,Buy,SOL,2,50',
    ].join('\n');
    const result = parsePortfolioCsv(csv, resolve);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.symbol).toBe('SOL');
    expect(result.skipped.map((item) => item.rowNumber)).toEqual([2, 3, 4, 5, 6]);
    expect(result.skipped[2]?.reason).toContain('Unresolved canonical instrument');
  });

  it('does not create data when the CSV has no data rows', () => {
    expect(parsePortfolioCsv('Date,Type,Symbol', resolve)).toEqual({
      trades: [],
      skipped: [{ rowNumber: 1, reason: 'CSV has no data rows.' }],
    });
  });
});
