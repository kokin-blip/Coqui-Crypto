import { describe, expect, it } from 'vitest';

import {
  instrumentKey,
  trendVolMinimumHistory,
  trendVolTargets,
  trendVolTargetsAt,
  type InstrumentIdentity,
  type InstrumentKey,
} from '../packages/core/src/index.js';

const BTC = instrumentKey({
  venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
} satisfies InstrumentIdentity);
const ETH = instrumentKey({
  venue: 'coinbase', productId: 'ETH-USD', productType: 'spot',
} satisfies InstrumentIdentity);
const BASE = [
  { assetId: BTC, weight: 0.6 },
  { assetId: ETH, weight: 0.4 },
];
const MOMENTUM = {
  lookbackDays: 10,
  volatilityDays: 5,
  maxRelativeTilt: 0.35,
  defensiveScale: 0.2,
  targetVolatilityPct: 55,
};
const VOL_TARGET = {
  targetVolPct: 40,
  volLookbackDays: 5,
  minExposure: 0.1,
  maxExposure: 1,
  trendGateDays: 10,
  belowTrendMaxExposure: 0.7,
};

function closes(start: number, count: number, dailyChange: number): number[] {
  return Array.from({ length: count }, (_, index) => start * (1 + dailyChange) ** index);
}

function mixIndex(series: ReadonlyMap<InstrumentKey, readonly number[]>): number[] {
  const btc = series.get(BTC)!;
  const eth = series.get(ETH)!;
  return btc.map((value, index) =>
    0.6 * (value / btc[0]!) + 0.4 * (eth[index]! / eth[0]!));
}

describe('shared TrendVol target composition', () => {
  it('derives the required history from the active configuration', () => {
    expect(trendVolMinimumHistory()).toBe(121);
    expect(trendVolMinimumHistory(MOMENTUM, VOL_TARGET)).toBe(11);
  });

  it('keeps indexed and current evaluation identical at the same endpoint', () => {
    const series = new Map<InstrumentKey, readonly number[]>([
      [BTC, closes(100, 40, 0.01)],
      [ETH, closes(80, 40, -0.003)],
    ]);
    const mix = mixIndex(series);
    const current = trendVolTargets(
      BASE,
      Object.fromEntries([...series].map(([key, values]) => [key, [...values]])) as
        Partial<Record<InstrumentKey, number[]>>,
      mix,
      { momentum: MOMENTUM, volTarget: VOL_TARGET, exposureScale: 0.8 },
    );
    const indexed = trendVolTargetsAt(BASE, series, mix, mix.length, {
      momentum: MOMENTUM, volTarget: VOL_TARGET, exposureScale: 0.8,
    });

    expect(indexed).toEqual(current);
    expect(current.historyStatus).toBe('complete');
    expect(current.targets.reduce((sum, target) => sum + target.weight, 0))
      .toBeLessThanOrEqual(1);
  });

  it('uses normalized base weights when momentum history is unavailable', () => {
    const series = new Map<InstrumentKey, readonly number[]>([
      [BTC, [100, 101]],
      [ETH, [100, 99]],
    ]);
    const result = trendVolTargetsAt(BASE, series, mixIndex(series), 2, {
      momentum: MOMENTUM,
      volTarget: VOL_TARGET,
    });

    expect(result.historyStatus).toBe('insufficient');
    expect(result.momentum.stats).toEqual([]);
    expect(result.targets.map((target) => target.weight)).toEqual([0.6, 0.4]);
    expect(result.cashWeight).toBe(0);
  });

  it('bounds an external exposure modifier without changing asset selection', () => {
    const series = new Map<InstrumentKey, readonly number[]>([
      [BTC, closes(100, 40, 0.01)],
      [ETH, closes(80, 40, 0.005)],
    ]);
    const mix = mixIndex(series);
    const zero = trendVolTargetsAt(BASE, series, mix, mix.length, {
      momentum: MOMENTUM, volTarget: VOL_TARGET, exposureScale: -1,
    });
    const capped = trendVolTargetsAt(BASE, series, mix, mix.length, {
      momentum: MOMENTUM, volTarget: VOL_TARGET, exposureScale: 10,
    });

    expect(zero.exposure).toBe(0);
    expect(zero.targets.every((target) => target.weight === 0)).toBe(true);
    expect(zero.cashWeight).toBe(1);
    expect(capped.exposure).toBe(1);
    expect(capped.targets.map((target) => target.assetId))
      .toEqual(zero.targets.map((target) => target.assetId));
  });
});
