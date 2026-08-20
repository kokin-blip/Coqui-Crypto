import { describe, expect, it } from 'vitest';

import {
  FixedClock,
  nonNegativeDecimal,
  type AssetRef,
  type TaxLot,
} from '@coqui/core';
import { PortfolioLedgerService, type TaxLotIdSource } from '@coqui/services';
import {
  insertTaxLots,
  listTaxLots,
  openDatabase,
  updateTaxLotRemaining,
} from '@coqui/storage';

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

const IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
] as const;

class FakeTaxLotIdSource implements TaxLotIdSource {
  readonly #ids: readonly string[];
  #index = 0;

  constructor(ids: readonly string[]) {
    this.#ids = ids;
  }

  nextId(): string {
    const id = this.#ids[this.#index];
    if (!id) throw new Error('Fake tax-lot IDs exhausted.');
    this.#index += 1;
    return id;
  }
}

function service(ids: readonly string[] = IDS) {
  const database = openDatabase(':memory:');
  const clock = new FixedClock(2_000);
  return {
    database,
    clock,
    ledger: new PortfolioLedgerService({
      database,
      clock,
      idSource: new FakeTaxLotIdSource(ids),
    }),
  };
}

function storedLot(
  id: string,
  source: TaxLot['source'],
  remaining = '2',
): TaxLot {
  return {
    id,
    asset: BTC,
    quantity: nonNegativeDecimal('2'),
    remaining: nonNegativeDecimal(remaining),
    costUsd: nonNegativeDecimal('100'),
    acquiredAt: 1_000,
    source,
    externalId: source === 'manual' ? null : `${source}-external`,
  };
}

describe('portfolio lot-ledger service', () => {
  it('uses deterministic IDs and injected time while detaching and freezing its view', () => {
    const context = service();
    const mutableAsset = {
      ...BTC,
      instrument: { ...BTC.instrument },
    };
    const added = context.ledger.addManualTaxLot({
      asset: mutableAsset,
      quantity: '0.123456789123456789',
      costUsd: '12345.6789123456789',
      acquiredAt: 1_500,
    });

    expect(added).toEqual({
      ok: true,
      lot: {
        id: IDS[0],
        asset: BTC,
        quantity: '0.123456789123456789',
        remaining: '0.123456789123456789',
        costUsd: '12345.6789123456789',
        acquiredAt: 1_500,
        source: 'manual',
        externalId: null,
      },
    });
    mutableAsset.name = 'mutated';
    mutableAsset.instrument.productId = 'MUTATED-USD';
    context.clock.set(2_500);
    const view = context.ledger.view();

    expect(view.asOfMs).toBe(2_500);
    expect(view.pricingStatus).toBe('unpriced');
    expect(view.lots[0]?.asset).toEqual(BTC);
    expect(view.holdings).toEqual([
      expect.objectContaining({
        asset: BTC,
        quantity: '0.123456789123456789',
        avgCostUsd: '100000',
        priceUsd: null,
        valueUsd: null,
      }),
    ]);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.lots)).toBe(true);
    expect(Object.isFrozen(view.lots[0]?.asset.instrument)).toBe(true);
    expect(Object.isFrozen(view.holdings[0]?.asset)).toBe(true);
    context.database.close();
  });

  it('rejects invalid input atomically without consuming an ID', () => {
    const context = service([IDS[0]]);
    const cases = [
      { quantity: '0', costUsd: '1', acquiredAt: 1_000, reasonCode: 'invalid_quantity' },
      { quantity: '-1', costUsd: '1', acquiredAt: 1_000, reasonCode: 'invalid_quantity' },
      { quantity: '1', costUsd: '-1', acquiredAt: 1_000, reasonCode: 'invalid_cost' },
      { quantity: '1', costUsd: '1', acquiredAt: 2_001, reasonCode: 'invalid_acquired_at' },
      { quantity: '1', costUsd: '1', acquiredAt: 1.5, reasonCode: 'invalid_acquired_at' },
    ] as const;

    for (const input of cases) {
      expect(context.ledger.addManualTaxLot({ asset: BTC, ...input }))
        .toEqual({ ok: false, reasonCode: input.reasonCode });
    }
    expect(context.ledger.addManualTaxLot({
      asset: { ...BTC, name: '' },
      quantity: '1',
      costUsd: '1',
      acquiredAt: 1_000,
    })).toEqual({ ok: false, reasonCode: 'invalid_asset' });
    expect(listTaxLots(context.database)).toEqual([]);

    expect(context.ledger.addManualTaxLot({
      asset: BTC,
      quantity: '1',
      costUsd: '1',
      acquiredAt: 1_000,
    })).toMatchObject({ ok: true, lot: { id: IDS[0] } });
    context.database.close();
  });

  it('fails closed on an invalid or conflicting injected ID', () => {
    const invalid = service(['not-a-uuid']);
    expect(() => invalid.ledger.addManualTaxLot({
      asset: BTC,
      quantity: '1',
      costUsd: '1',
      acquiredAt: 1_000,
    })).toThrow('Tax-lot ID source must return a UUIDv4');
    expect(listTaxLots(invalid.database)).toEqual([]);
    invalid.database.close();

    const conflict = service([IDS[0]]);
    insertTaxLots([storedLot(IDS[0], 'manual')], conflict.database);
    expect(conflict.ledger.addManualTaxLot({
      asset: BTC,
      quantity: '1',
      costUsd: '1',
      acquiredAt: 1_000,
    })).toEqual({ ok: false, reasonCode: 'lot_id_conflict' });
    expect(listTaxLots(conflict.database)).toHaveLength(1);
    conflict.database.close();
  });

  it('uses canonical identity for asset lots even when symbols collide', () => {
    const context = service();
    insertTaxLots([
      storedLot('btc-manual', 'manual'),
      { ...storedLot('wbtc-manual', 'manual'), asset: WBTC },
    ], context.database);

    expect(context.ledger.listAssetLots(BTC.instrument).map((lot) => lot.id))
      .toEqual(['btc-manual']);
    expect(context.ledger.listAssetLots(WBTC.instrument).map((lot) => lot.id))
      .toEqual(['wbtc-manual']);
    context.database.close();
  });

  it('removes only wholly unconsumed manual lots and preserves every rejected lot', () => {
    const context = service();
    insertTaxLots([
      storedLot('manual-open', 'manual'),
      storedLot('manual-used', 'manual'),
      storedLot('coinbase-open', 'coinbase'),
    ], context.database);
    updateTaxLotRemaining('manual-used', '1', context.database);

    expect(context.ledger.removeManualTaxLot('missing'))
      .toEqual({ ok: false, reasonCode: 'lot_not_found' });
    expect(context.ledger.removeManualTaxLot('coinbase-open'))
      .toEqual({ ok: false, reasonCode: 'lot_not_manual' });
    expect(context.ledger.removeManualTaxLot('manual-used'))
      .toEqual({ ok: false, reasonCode: 'lot_has_disposals' });
    expect(context.ledger.removeManualTaxLot('manual-open'))
      .toEqual({ ok: true, removedLot: storedLot('manual-open', 'manual') });

    expect(listTaxLots(context.database).map((lot) => lot.id))
      .toEqual(['coinbase-open', 'manual-used']);
    context.database.close();
  });
});
