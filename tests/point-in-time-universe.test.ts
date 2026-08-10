import { describe, expect, it } from 'vitest';

import {
  buildPointInTimeUniverseTimeline,
  createPointInTimeUniverseSnapshot,
  instrumentKey,
  type InstrumentIdentity,
  type UniverseProductObservation,
} from '../packages/core/src/index.js';

const BTC: InstrumentIdentity = {
  venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
};
const ETH: InstrumentIdentity = {
  venue: 'coinbase', productId: 'ETH-USD', productType: 'spot',
};
const JAN_1_NOON = Date.UTC(2025, 0, 1, 12);

function product(
  instrument: InstrumentIdentity,
  overrides: Partial<UniverseProductObservation> = {},
): UniverseProductObservation {
  return {
    instrument,
    baseAsset: instrument.productId.split('-')[0]!,
    quoteAsset: 'USD',
    status: 'online',
    tradingDisabled: false,
    cancelOnly: false,
    limitOnly: false,
    postOnly: false,
    baseIncrement: '0.00000001',
    quoteIncrement: '0.01',
    minMarketFunds: '1',
    ...overrides,
  };
}

describe('point-in-time universe', () => {
  it('is content-stable, canonical, and effective only on the following UTC day', () => {
    const left = createPointInTimeUniverseSnapshot(
      JAN_1_NOON, [product(ETH), product(BTC)],
    );
    const right = createPointInTimeUniverseSnapshot(
      JAN_1_NOON, [product(BTC), product(ETH)],
    );
    expect(left.snapshotHash).toBe(right.snapshotHash);
    expect(left.effectiveFromDayKey).toBe('2025-01-02');
    expect(left.products.map((value) => value.instrument.productId))
      .toEqual(['BTC-USD', 'ETH-USD']);
    expect(Object.isFrozen(left.products)).toBe(true);
  });

  it('does not leak a current observation backward or across a missed day', () => {
    const snapshot = createPointInTimeUniverseSnapshot(
      JAN_1_NOON, [product(BTC), product(ETH)],
    );
    const timeline = buildPointInTimeUniverseTimeline(
      [snapshot], ['2025-01-01', '2025-01-02', '2025-01-03'],
    );
    expect(timeline.uncoveredDayKeys).toEqual(['2025-01-01', '2025-01-03']);
    expect(timeline.membershipsByDay['2025-01-02']?.eligibleAssets)
      .toEqual([instrumentKey(BTC), instrumentKey(ETH)]);
  });

  it('records a delisting only after it was observed', () => {
    const online = createPointInTimeUniverseSnapshot(
      JAN_1_NOON, [product(BTC), product(ETH)],
    );
    const delisted = createPointInTimeUniverseSnapshot(
      JAN_1_NOON + 86_400_000, [product(BTC), product(ETH, { status: 'delisted' })],
    );
    const timeline = buildPointInTimeUniverseTimeline(
      [online, delisted], ['2025-01-02', '2025-01-03'],
    );
    expect(timeline.membershipsByDay['2025-01-02']?.eligibleAssets).toContain(instrumentKey(ETH));
    expect(timeline.membershipsByDay['2025-01-03']?.eligibleAssets)
      .toEqual([instrumentKey(BTC)]);
    expect(timeline.membershipsByDay['2025-01-03']?.excludedAssets[instrumentKey(ETH)])
      .toEqual(['status_not_online']);
  });

  it('fails closed when trading rules are unknown', () => {
    const snapshot = createPointInTimeUniverseSnapshot(
      JAN_1_NOON, [product(BTC, { cancelOnly: null })],
    );
    const timeline = buildPointInTimeUniverseTimeline([snapshot], ['2025-01-02']);
    expect(timeline.membershipsByDay['2025-01-02']?.eligibleAssets).toEqual([]);
    expect(timeline.membershipsByDay['2025-01-02']?.excludedAssets[instrumentKey(BTC)])
      .toEqual(['rules_unknown']);
  });

  it('rejects tampered snapshots', () => {
    const snapshot = createPointInTimeUniverseSnapshot(JAN_1_NOON, [product(BTC)]);
    expect(() => buildPointInTimeUniverseTimeline([
      { ...snapshot, snapshotHash: '0'.repeat(64) },
    ], ['2025-01-02'])).toThrow('integrity');
  });
});
