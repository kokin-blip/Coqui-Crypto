import { describe, expect, it } from 'vitest';

import type { CsvAssetResolver, CsvInstrumentResolver } from '../packages/core/src/index.js';
import { PortfolioCsvImportService } from '../packages/services/src/index.js';
import { listDisposals, listTaxLots, openDatabase, type Db } from '../packages/storage/src/index.js';

const resolveInstrument: CsvInstrumentResolver = (symbol) =>
  ['BTC', 'ETH'].includes(symbol)
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

const BUYS = [
  'Date,Type,Symbol,Quantity,Total USD',
  '2024-01-01,Buy,BTC,0.2,8000',
  '2024-02-01,Buy,BTC,0.1,5000',
].join('\n');

const SELL = ['Date,Type,Symbol,Quantity,Total USD', '2024-03-01,Sell,BTC,0.15,9000'].join('\n');

function service(database: Db): PortfolioCsvImportService {
  return new PortfolioCsvImportService({ database, resolveInstrument, resolveAsset });
}

describe('preview shows what a file will do, and does nothing', () => {
  it('reports the plan without writing', () => {
    const database = openDatabase(':memory:');
    const preview = service(database).preview(BUYS);

    expect(preview.plan.newLotCount).toBe(2);
    // An import rewrites the cost-basis book. UI-UX §3.1 forbids optimistic
    // success on exactly that, so seeing the effect must not be the effect.
    expect(listTaxLots(database)).toHaveLength(0);
    database.close();
  });
});

describe('commit persists the plan once', () => {
  it('writes the lots', () => {
    const database = openDatabase(':memory:');
    const imports = service(database);

    expect(imports.commit(BUYS)).toEqual({ ok: true, newLotCount: 2, disposalCount: 0 });
    expect(listTaxLots(database)).toHaveLength(2);
    database.close();
  });

  it('refuses a second import of the same file', () => {
    const database = openDatabase(':memory:');
    const imports = service(database);
    imports.commit(BUYS);

    // Duplicate protection reads the ledger the import itself wrote: an
    // imported lot carries its fingerprint as `externalId`. No parallel table
    // means nothing to drift out of sync.
    expect(imports.commit(BUYS)).toEqual({ ok: false, code: 'nothing_to_import' });
    expect(listTaxLots(database)).toHaveLength(2);
    database.close();
  });

  it('imports only the new rows from an overlapping export', () => {
    const database = openDatabase(':memory:');
    const imports = service(database);
    imports.commit(BUYS);

    const overlapping = [BUYS, '2024-04-01,Buy,ETH,2,6000'].join('\n');
    expect(imports.commit(overlapping)).toMatchObject({ ok: true, newLotCount: 1 });
    expect(listTaxLots(database)).toHaveLength(3);
    database.close();
  });
});

describe('a sell consumes lots and records disposals', () => {
  it('reduces the lot book and appends the disposal', () => {
    const database = openDatabase(':memory:');
    const imports = service(database);
    imports.commit(BUYS);

    expect(imports.commit(SELL)).toMatchObject({ ok: true, disposalCount: 1 });
    expect(listDisposals(database)).toHaveLength(1);

    // FIFO takes 0.15 from the 0.2 lot. Both acquisitions survive, one
    // partially consumed — deleting a lot would take its cost basis with it and
    // leave the disposal citing nothing.
    const lots = listTaxLots(database);
    expect(lots).toHaveLength(2);
    expect(lots.map((lot) => lot.remaining).sort()).toEqual(['0.05', '0.1']);
    database.close();
  });

  it('does not replay a sell that is already recorded', () => {
    const database = openDatabase(':memory:');
    const imports = service(database);
    imports.commit(BUYS);
    imports.commit(SELL);

    expect(imports.commit(SELL)).toEqual({ ok: false, code: 'nothing_to_import' });
    expect(listDisposals(database)).toHaveLength(1);
    database.close();
  });

  it('fully consumes a lot without deleting its acquisition', () => {
    const database = openDatabase(':memory:');
    const imports = service(database);
    imports.commit(BUYS);
    // 0.25 clears the 0.2 lot entirely and takes 0.05 from the second.
    imports.commit(['Date,Type,Symbol,Quantity,Total USD', '2024-03-01,Sell,BTC,0.25,15000'].join('\n'));

    const lots = listTaxLots(database);
    expect(lots).toHaveLength(2);
    expect(lots.map((lot) => lot.remaining).sort()).toEqual(['0', '0.05']);
    database.close();
  });

  it('reports the shortfall rather than inventing a lot to cover it', () => {
    const database = openDatabase(':memory:');
    const imports = service(database);
    const oversized = [
      'Date,Type,Symbol,Quantity,Total USD',
      '2024-03-01,Sell,BTC,5,300000',
    ].join('\n');

    const preview = imports.preview(oversized);
    // Invariant 12: an uncovered sell is an exception, never a fabricated
    // zero-basis lot conjured to make the arithmetic close.
    expect(preview.plan.skipped[0]?.reason).toContain('exceeded open BTC lots');
    expect(preview.plan.newLotCount).toBe(0);
    database.close();
  });
});
