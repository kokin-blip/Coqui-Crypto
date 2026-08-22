import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  FixedClock,
  type AllocationPolicy,
  type AssetRef,
  type Holding,
  type InstrumentIdentity,
  type MarketBar,
  type ProductRuleSnapshot,
  type UsdAmount,
} from '../packages/core/src/index.js';
import {
  reconcilePaperFills,
  runPaperDecision,
  type PaperMarketData,
  type PaperRunLoopDependencies,
} from '../packages/services/src/index.js';
import {
  bootstrapPaperBalances,
  listRuntimeIncidents,
  openDatabase,
  type Db,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const PROFILE = 'main';

const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
const BTC_KEY = instrumentKey(BTC);
const ETH: InstrumentIdentity = { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' };
const ETH_KEY = instrumentKey(ETH);

const BTC_REF: AssetRef = {
  instrument: BTC,
  symbol: 'BTC',
  name: 'Bitcoin',
  baseAsset: 'BTC',
  quoteAsset: 'USD',
  coingeckoId: 'bitcoin',
};
const ETH_REF: AssetRef = { ...BTC_REF, instrument: ETH, symbol: 'ETH', baseAsset: 'ETH' };

const RULES: ProductRuleSnapshot = {
  id: 'a'.repeat(64),
  instrument: BTC,
  status: 'online',
  tradingDisabled: false,
  cancelOnly: false,
  limitOnly: false,
  postOnly: false,
  viewOnly: false,
  baseIncrement: '0.00000001',
  quoteIncrement: '0.01',
  priceIncrement: '0.01',
  baseMinSize: '0.00000001',
  baseMaxSize: null,
  quoteMinSize: '1',
  quoteMaxSize: null,
  source: 'coinbase',
  retrievedAt: T0,
  responseHash: 'b'.repeat(64),
};

const POLICY: AllocationPolicy = {
  targets: [
    { instrument: BTC, weight: 0.5 },
    { instrument: ETH, weight: 0.5 },
  ],
  rebalanceBandPct: 1,
};

function bars(count = 30, shift = 0): MarketBar[] {
  return Array.from({ length: count }, (_, index) => ({
    assetId: BTC_KEY,
    source: 'coinbase' as const,
    interval: '1d' as const,
    startTimeMs: T0 + index * DAY,
    endTimeMs: T0 + (index + 1) * DAY,
    open: 100 + index + shift,
    high: 130 + index,
    low: 80 + index,
    close: 110 + index,
    volume: 100,
    isComplete: true,
    retrievedAtMs: T0,
  }));
}

function holding(asset: AssetRef, valueUsd: string, quantity: string): Holding {
  return {
    asset,
    quantity: quantity as Holding['quantity'],
    avgCostUsd: '100.00' as UsdAmount,
    priceUsd: '110.00' as UsdAmount,
    valueUsd: valueUsd as UsdAmount,
    unrealizedPnlUsd: '0' as UsdAmount,
    unrealizedPnlPct: 0,
  };
}

function seeded(): Db {
  const db = openDatabase(':memory:');
  bootstrapPaperBalances(
    PROFILE,
    [
      { assetId: 'USD', quantity: '10000' },
      { assetId: ETH_KEY, quantity: '9' },
    ],
    'seed',
    T0,
    db,
  );
  return db;
}

function runOnce(db: Db, market: PaperMarketData): void {
  const deps: PaperRunLoopDependencies = {
    database: db,
    clock: new FixedClock(T0 + DAY),
    profileId: PROFILE,
    market,
    holdings: () => [holding(BTC_REF, '100.00', '1'), holding(ETH_REF, '900.00', '9')],
    policy: () => POLICY,
    historicalNetEdgeEstimatePct: 12,
  };
  runPaperDecision(deps, T0 + DAY);
}

describe('a venue that matches the engine reconciles clean', () => {
  it('reports alignment when nothing moved underneath', () => {
    const db = seeded();
    const market: PaperMarketData = { bars: () => bars(), rules: () => RULES };
    runOnce(db, market);

    const report = reconcilePaperFills(
      { database: db, clock: new FixedClock(T0 + 2 * DAY), market },
      PROFILE,
      0,
    );

    expect(report.fillCount).toBeGreaterThan(0);
    // The venue was built to match backtest/engine.ts, so agreement here is
    // the expected result — and a failure would mean one of them drifted.
    expect(report.divergedCount).toBe(0);
    expect(report.unverifiableCount).toBe(0);
    expect(Math.abs(report.worstPriceDivergenceBps ?? 0)).toBeLessThan(5);
    db.close();
  });

  it('raises no incident when everything agrees', () => {
    const db = seeded();
    const market: PaperMarketData = { bars: () => bars(), rules: () => RULES };
    runOnce(db, market);
    reconcilePaperFills({ database: db, clock: new FixedClock(T0 + 2 * DAY), market }, PROFILE, 0);

    expect(listRuntimeIncidents(PROFILE, false, 50, db)).toHaveLength(0);
    db.close();
  });
});

describe('a moved bar is reported, not absorbed', () => {
  it('detects and records a material price divergence', () => {
    const db = seeded();
    const original: PaperMarketData = { bars: () => bars(), rules: () => RULES };
    runOnce(db, original);

    // The bars are restated after the fill — a revised feed, or a provider
    // correcting itself. The harness must notice rather than quietly agree.
    const restated: PaperMarketData = { bars: () => bars(30, 20), rules: () => RULES };
    const report = reconcilePaperFills(
      { database: db, clock: new FixedClock(T0 + 2 * DAY), market: restated },
      PROFILE,
      0,
    );

    expect(report.divergedCount).toBeGreaterThan(0);
    expect(Math.abs(report.worstPriceDivergenceBps ?? 0)).toBeGreaterThan(5);

    const incidents = listRuntimeIncidents(PROFILE, false, 50, db);
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents[0]?.kind).toBe('reconciliation');
    expect(incidents[0]?.source).toBe('paper_reconciliation');
    db.close();
  });

  it('escalates a large divergence to blocking severity', () => {
    const db = seeded();
    runOnce(db, { bars: () => bars(), rules: () => RULES });

    const wildlyRestated: PaperMarketData = { bars: () => bars(30, 500), rules: () => RULES };
    reconcilePaperFills(
      { database: db, clock: new FixedClock(T0 + 2 * DAY), market: wildlyRestated },
      PROFILE,
      0,
    );

    // Past the severe threshold the model is wrong, not noisy — and a wrong
    // model is exactly what makes a backtest dishonest.
    expect(listRuntimeIncidents(PROFILE, false, 50, db)[0]?.severity).toBe('blocking');
    db.close();
  });

  it('reports the signed mean so a systematic bias is visible', () => {
    const db = seeded();
    runOnce(db, { bars: () => bars(), rules: () => RULES });
    const report = reconcilePaperFills(
      { database: db, clock: new FixedClock(T0 + 2 * DAY), market: { bars: () => bars(30, 20), rules: () => RULES } },
      PROFILE,
      0,
    );
    // Signed, not absolute: a consistent one-directional error would otherwise
    // average away against itself.
    expect(report.meanPriceDivergenceBps).not.toBeNull();
    expect(report.meanPriceDivergenceBps).toBeLessThan(0);
    db.close();
  });
});

describe('missing evidence is unverifiable, never aligned', () => {
  it('refuses to claim agreement when the bar is gone', () => {
    const db = seeded();
    runOnce(db, { bars: () => bars(), rules: () => RULES });

    const forgotten: PaperMarketData = { bars: () => [], rules: () => RULES };
    const report = reconcilePaperFills(
      { database: db, clock: new FixedClock(T0 + 2 * DAY), market: forgotten },
      PROFILE,
      0,
    );

    expect(report.fillCount).toBeGreaterThan(0);
    // Counting missing evidence as agreement would let the harness report
    // health it has not established.
    expect(report.alignedCount).toBe(0);
    expect(report.unverifiableCount).toBe(report.fillCount);
    expect(report.worstPriceDivergenceBps).toBeNull();
    db.close();
  });

  it('returns an empty report rather than failing when nothing has filled', () => {
    const db = seeded();
    const report = reconcilePaperFills(
      { database: db, clock: new FixedClock(T0), market: { bars: () => bars(), rules: () => RULES } },
      PROFILE,
      0,
    );
    expect(report.fillCount).toBe(0);
    expect(report.meanPriceDivergenceBps).toBeNull();
    db.close();
  });

  it('is idempotent — re-running does not multiply incidents', () => {
    const db = seeded();
    runOnce(db, { bars: () => bars(), rules: () => RULES });
    const restated: PaperMarketData = { bars: () => bars(30, 20), rules: () => RULES };
    const deps = { database: db, clock: new FixedClock(T0 + 2 * DAY), market: restated };

    reconcilePaperFills(deps, PROFILE, 0);
    const first = listRuntimeIncidents(PROFILE, false, 50, db).length;
    reconcilePaperFills(deps, PROFILE, 0);

    // The incident id is derived from the fill, and the table is append-only
    // and idempotent by id.
    expect(listRuntimeIncidents(PROFILE, false, 50, db)).toHaveLength(first);
    db.close();
  });
});
