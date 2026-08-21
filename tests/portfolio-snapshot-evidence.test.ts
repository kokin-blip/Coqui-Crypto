import { describe, expect, it } from 'vitest';

import {
  createPortfolioEvidenceSnapshot,
  instrumentKey,
  nonNegativeDecimal,
  summarizePortfolioEvidence,
  type AssetRef,
  type Clock,
  type PortfolioEvidenceSnapshotInput,
  type PriceSource,
  type SpotPriceObservation,
  type TaxLot,
} from '@coqui/core';
import { PortfolioReadModelService, PortfolioSnapshotEvidenceService } from '@coqui/services';
import {
  insertTaxLots,
  listPortfolioEvidenceSnapshots,
  migrations,
  openDatabase,
  runMigrations,
  savePortfolioEvidenceSnapshot,
  savePortfolioSnapshot,
} from '@coqui/storage';

const DAY = 86_400_000;
const BTC: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};
const ETH: AssetRef = {
  instrument: { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
  symbol: 'ETH',
  name: 'Ethereum',
  baseAsset: 'ETH',
  quoteAsset: 'USD',
  coingeckoId: 'ethereum',
};
const BTC_KEY = instrumentKey(BTC.instrument);
const ETH_KEY = instrumentKey(ETH.instrument);

function input(overrides: Partial<PortfolioEvidenceSnapshotInput> = {}): PortfolioEvidenceSnapshotInput {
  return {
    scheduledForMs: DAY,
    observedAtMs: DAY + 10,
    recordedAtMs: DAY + 20,
    valuationStatus: 'complete',
    equityUsd: '100',
    pricedSubtotalUsd: '100',
    openCostUsd: '80',
    realizedPnlUsd: '5',
    unpricedInstrumentKeys: [],
    ...overrides,
  };
}

function lot(id: string, asset: AssetRef): TaxLot {
  return {
    id,
    asset,
    quantity: nonNegativeDecimal('1'),
    remaining: nonNegativeDecimal('1'),
    costUsd: nonNegativeDecimal('50'),
    acquiredAt: 1,
    source: 'manual',
    externalId: null,
  };
}

class ScriptedClock implements Clock {
  constructor(private readonly values: number[]) {}
  nowMs(): number {
    const value = this.values.shift();
    if (value === undefined) throw new Error('Clock script exhausted.');
    return value;
  }
}

describe('portfolio snapshot evidence contract', () => {
  it('canonicalizes provenance and never permits a partial subtotal to become equity', () => {
    const partial = createPortfolioEvidenceSnapshot(input({
      valuationStatus: 'partial',
      equityUsd: null,
      unpricedInstrumentKeys: [ETH_KEY, BTC_KEY, ETH_KEY],
    }));
    expect(partial.dayKeyMs).toBe(DAY);
    expect(partial.unpricedInstrumentKeys).toEqual([BTC_KEY, ETH_KEY]);
    expect(partial.equityUsd).toBeNull();
    expect(Object.isFrozen(partial)).toBe(true);
    expect(Object.isFrozen(partial.unpricedInstrumentKeys)).toBe(true);
    expect(() => createPortfolioEvidenceSnapshot(input({
      valuationStatus: 'partial',
      equityUsd: '100',
      unpricedInstrumentKeys: [ETH_KEY],
    }))).toThrow('cannot contain complete equity');
    expect(() => createPortfolioEvidenceSnapshot(input({ observedAtMs: DAY - 1 })))
      .toThrow('scheduled, observed, recorded order');
    expect(() => createPortfolioEvidenceSnapshot(input({
      valuationStatus: 'unknown' as 'complete',
      equityUsd: null,
    }))).toThrow('valuation status is invalid');
    expect(createPortfolioEvidenceSnapshot(input({
      valuationStatus: 'unavailable',
      equityUsd: null,
      pricedSubtotalUsd: '0',
      unpricedInstrumentKeys: [BTC_KEY, ETH_KEY],
    }))).toMatchObject({ valuationStatus: 'unavailable', equityUsd: null });
  });

  it('uses the latest observation per UTC day and excludes incomplete and legacy days', () => {
    const dayOne = createPortfolioEvidenceSnapshot(input());
    const partial = createPortfolioEvidenceSnapshot(input({
      scheduledForMs: DAY * 2,
      observedAtMs: DAY * 2 + 10,
      recordedAtMs: DAY * 2 + 20,
      valuationStatus: 'partial',
      equityUsd: null,
      pricedSubtotalUsd: '50',
      unpricedInstrumentKeys: [ETH_KEY],
    }));
    const recovered = createPortfolioEvidenceSnapshot(input({
      scheduledForMs: DAY * 2,
      observedAtMs: DAY * 2 + 30,
      recordedAtMs: DAY * 3 + 5,
      equityUsd: '100',
      pricedSubtotalUsd: '100',
    }));
    const legacy = createPortfolioEvidenceSnapshot(input({
      scheduledForMs: DAY * 3,
      observedAtMs: DAY * 3,
      recordedAtMs: DAY * 3,
      valuationStatus: 'legacy_unverified',
      equityUsd: null,
    }));
    const result = summarizePortfolioEvidence([legacy, recovered, partial, dayOne]);
    expect(result.dailyEvidence).toEqual([dayOne, recovered, legacy]);
    expect(result.verifiedEvidence).toEqual([dayOne, recovered]);
    expect(result.excludedDayKeys).toEqual([DAY * 3]);
    expect(result.performance.timeWeightedReturnPct).toBe(0);
    expect(result.performance.bestDayPct).toBe(0);
    expect(result.performance.worstDayPct).toBe(0);
  });
});

describe('append-only portfolio snapshot storage', () => {
  it('migrates old snapshots as legacy-unverified evidence', () => {
    const database = openDatabase(':memory:', { migrations: migrations.slice(0, 37) });
    savePortfolioSnapshot({
      at: DAY + 123,
      valueUsd: nonNegativeDecimal('25'),
      costUsd: nonNegativeDecimal('20'),
      realizedPnlUsd: nonNegativeDecimal('1'),
    }, database);
    expect(runMigrations(database)).toBe(45);
    expect(listPortfolioEvidenceSnapshots(database)).toEqual([
      createPortfolioEvidenceSnapshot(input({
        scheduledForMs: DAY,
        observedAtMs: DAY,
        recordedAtMs: DAY,
        valuationStatus: 'legacy_unverified',
        equityUsd: null,
        pricedSubtotalUsd: '25',
        openCostUsd: '20',
        realizedPnlUsd: '1',
      })),
    ]);
    database.close();
  });

  it('keeps all facts, treats exact retries idempotently, and bounds only reads', () => {
    const database = openDatabase(':memory:');
    const snapshots = [1, 2, 3].map((day) => createPortfolioEvidenceSnapshot(input({
      scheduledForMs: DAY * day,
      observedAtMs: DAY * day + 10,
      recordedAtMs: DAY * day + 20,
      equityUsd: String(100 + day),
      pricedSubtotalUsd: String(100 + day),
    })));
    expect(savePortfolioEvidenceSnapshot(snapshots[0]!, database)).toEqual({ created: true });
    expect(savePortfolioEvidenceSnapshot(snapshots[0]!, database)).toEqual({ created: false });
    savePortfolioEvidenceSnapshot(snapshots[1]!, database);
    savePortfolioEvidenceSnapshot(snapshots[2]!, database);
    expect(listPortfolioEvidenceSnapshots(database, { limit: 2 })).toEqual(snapshots.slice(1));
    expect(database.prepare('SELECT COUNT(*) AS count FROM portfolio_snapshot_evidence_v3').get())
      .toEqual({ count: 3 });
    expect(() => database.prepare(
      'UPDATE portfolio_snapshot_evidence_v3 SET priced_subtotal_usd_text = ? WHERE id = ?',
    ).run('999', snapshots[0]!.id)).toThrow('immutable');
    expect(() => listPortfolioEvidenceSnapshots(database, { limit: 0 })).toThrow(RangeError);
    database.close();
  });
});

describe('portfolio snapshot evidence service', () => {
  it('records partial evidence, then a late complete recovery without deleting either fact', async () => {
    const database = openDatabase(':memory:');
    insertTaxLots([lot('btc', BTC), lot('eth', ETH)], database);
    let call = 0;
    const priceSource: PriceSource = {
      name: 'fixture',
      spot: async () => {
        call += 1;
        const values = new Map<string, SpotPriceObservation>([[BTC_KEY, {
          priceUsd: nonNegativeDecimal('100'),
          source: 'coinbase',
          quality: 'venue_reported_last',
          observedAtMs: null,
        }]]);
        if (call > 1) values.set(ETH_KEY, {
          priceUsd: nonNegativeDecimal('50'),
          source: 'coinbase',
          quality: 'venue_reported_last',
          observedAtMs: null,
        });
        return values;
      },
    };
    const clock = new ScriptedClock([
      DAY + 10, DAY + 20, DAY + 30,
      DAY + 40, DAY + 50, DAY * 2 + 5,
    ]);
    const reads = new PortfolioReadModelService({ database, clock, priceSource });
    const service = new PortfolioSnapshotEvidenceService({ database, clock, portfolioReads: reads });
    const partial = await service.capture(DAY);
    const recovered = await service.capture(DAY);

    expect(partial.snapshot).toMatchObject({
      dayKeyMs: DAY,
      valuationStatus: 'partial',
      equityUsd: null,
      pricedSubtotalUsd: '100',
      unpricedInstrumentKeys: [ETH_KEY],
    });
    expect(recovered.snapshot).toMatchObject({
      dayKeyMs: DAY,
      observedAtMs: DAY + 50,
      recordedAtMs: DAY * 2 + 5,
      valuationStatus: 'complete',
      equityUsd: '150',
      unpricedInstrumentKeys: [],
    });
    expect(service.history()).toHaveLength(2);
    expect(service.performance().dailyEvidence).toEqual([recovered.snapshot]);
    expect(service.performance().excludedDayKeys).toEqual([]);
    database.close();
  });
});
