import { describe, expect, it } from 'vitest';
import { DEFAULT_MOMENTUM_CONFIG, instrumentKey, momentumTargets, trendVolTargets, trendVolTargetsAt } from '../packages/core/src/index.js';
import { momentumTargetsAt } from '../packages/core/src/strategies/momentum.js';

const assets = ['BTC-USD', 'ETH-USD', 'LTC-USD'].map((productId) =>
  instrumentKey({ venue: 'coinbase', productId, productType: 'spot' }));
const [btc, eth, ltc] = assets;
const base = assets.slice(0, 2).map((assetId) => ({ assetId, weight: 0.5 }));
const path = (rate: number) => Array.from({ length: 121 }, (_, i) =>
  100 * Math.exp(rate * i + 0.001 * Math.sin(2 * Math.PI * i / 10)));
const config = { ...DEFAULT_MOMENTUM_CONFIG, relativeScoreSpreadFloor: 0.25 };
const nearTie = { [btc!]: path(0.000100001), [eth!]: path(0.0001) };

describe('research-only momentum spread floor', () => {
  it('removes the maximum-tilt near-tie reversal and converges to neutral', () => {
    const legacy = momentumTargets(base, nearTie);
    expect(legacy.targets.map((t) => t.weight)).toEqual([0.675, 0.325]);
    const forward = momentumTargets(base, nearTie, config);
    const reverse = momentumTargets(base, { [btc!]: nearTie[eth!]!, [eth!]: nearTie[btc!]! }, config);
    expect(forward.targets[0]!.weight).toBeGreaterThan(0.5);
    expect(forward.targets[0]!.weight - 0.5).toBeLessThan(0.0001);
    expect(reverse.targets[0]!.weight).toBeCloseTo(forward.targets[1]!.weight, 14);
    const closer = momentumTargets(base, { [btc!]: path(0.0001000001), [eth!]: path(0.0001) }, config);
    expect(Math.abs(closer.targets[0]!.weight - 0.5)).toBeLessThan(Math.abs(forward.targets[0]!.weight - 0.5));
  });

  it('keeps equal scores and a single asset neutral, including unequal base weights', () => {
    const unequal = [{ assetId: btc!, weight: 0.7 }, { assetId: eth!, weight: 0.3 }];
    expect(momentumTargets(unequal, { [btc!]: path(0.0001), [eth!]: path(0.0001) }, config).targets).toEqual(unequal);
    expect(momentumTargets([base[0]!], nearTie, config).targets[0]!.weight).toBe(1);
  });

  it('preserves the original arithmetic at and above the chosen floor', () => {
    const legacy = momentumTargets(base, nearTie);
    const spread = Math.abs(legacy.stats[0]!.riskAdjustedMomentum - legacy.stats[1]!.riskAdjustedMomentum);
    for (const floor of [0, spread / 2, spread]) {
      expect(momentumTargets(base, nearTie, { ...config, relativeScoreSpreadFloor: floor })).toEqual(legacy);
    }
    const reduced = momentumTargets(base, nearTie, { ...config, relativeScoreSpreadFloor: spread * 2 });
    expect(reduced.targets[0]!.weight).toBeCloseTo(0.5875, 14);
    const aboveBoundary = momentumTargets(base, nearTie, { ...config, relativeScoreSpreadFloor: spread * (1 + 1e-8) });
    expect(aboveBoundary.targets[0]!.weight).toBeCloseTo(legacy.targets[0]!.weight, 8);
  });

  it('handles score spreads below, exactly at and above 0.25', () => {
    // One observed return has zero estimated volatility, so the score is the return itself.
    const short = { ...config, lookbackDays: 1 };
    for (const [finish, expected] of [[112.5, 0.5875], [125, 0.675], [150, 0.675]]) {
      const result = momentumTargets(base, { [btc!]: [100, finish!], [eth!]: [100, 100] }, short);
      expect(result.targets[0]!.weight).toBeCloseTo(expected!, 14);
    }
  });

  it('keeps three-asset tilts ordered, bounded and fully accounted for', () => {
    const three = assets.map((assetId) => ({ assetId, weight: 1 / 3 }));
    const result = momentumTargets(three, { ...nearTie, [ltc!]: path(0.000099999) }, config);
    const weights = result.targets.map((t) => t.weight);
    expect(weights[0]).toBeGreaterThan(weights[1]!);
    expect(weights[1]).toBeGreaterThan(weights[2]!);
    for (const weight of weights) {
      expect(Number.isFinite(weight)).toBe(true);
      expect(weight).toBeGreaterThanOrEqual(0.65 / 3);
      expect(weight).toBeLessThanOrEqual(1.35 / 3);
    }
    expect(weights.reduce((a, b) => a + b, 0) + result.cashWeight).toBeCloseTo(1, 14);
  });

  it('leaves zero-floor behavior, defensive scaling and missing history unchanged', () => {
    for (const series of [nearTie, { [btc!]: path(-0.001), [eth!]: path(-0.002) }, { [btc!]: path(0.001), [eth!]: [100] }]) {
      expect(momentumTargets(base, series, { ...config, relativeScoreSpreadFloor: 0 })).toEqual(momentumTargets(base, series));
    }
    const partial = momentumTargets(base, { [btc!]: path(0.001), [eth!]: [100] }, config);
    expect(partial.targets[1]!.weight).toBe(0);
    expect(partial.cashWeight).toBe(0.5);
    const falling = { [btc!]: path(-0.001), [eth!]: path(-0.001) };
    expect(momentumTargets(base, falling, config)).toEqual(momentumTargets(base, falling));
  });

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid floor %s even without observations', (floor) => {
    const invalid = { ...config, relativeScoreSpreadFloor: floor };
    expect(() => momentumTargets([], {}, invalid)).toThrow('relativeScoreSpreadFloor');
    expect(() => momentumTargetsAt([], new Map(), 0, invalid)).toThrow('relativeScoreSpreadFloor');
  });

  it('keeps indexed/current paths identical and ignores future observations', () => {
    const mix = nearTie[btc!]!.map((v, i) => (v + nearTie[eth!]![i]!) / 2);
    const options = { momentum: config };
    const current = trendVolTargets(base, nearTie, mix, options);
    const series = new Map(assets.slice(0, 2).map((assetId) => [assetId, [...nearTie[assetId]!, 1e8, 1]]));
    expect(trendVolTargetsAt(base, series, [...mix, 1e8, 1], 121, options)).toEqual(current);
    expect(momentumTargetsAt(base, series, 121, config)).toEqual(momentumTargets(base, nearTie, config));
  });
});
