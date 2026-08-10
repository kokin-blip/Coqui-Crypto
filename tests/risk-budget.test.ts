import { describe, expect, it } from 'vitest';
import {
  alignReturns,
  correlation,
  covariance,
  dailyReturns,
  hrpWeights,
  inverseVolWeights,
  quasiDiag,
  riskBudgetWeights,
  singleLinkage,
} from '../packages/core/src/index.js';

function rng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe('risk-budget statistics', () => {
  it('computes returns and guards invalid predecessor prices', () => {
    expect(dailyReturns([100, 110, 99])).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(-0.1, 5),
    ]);
    expect(dailyReturns([0, 100])).toEqual([0]);
  });

  it('derives positive and negative perfect correlations', () => {
    const series = [0.01, -0.02, 0.03, -0.01, 0.02];
    expect(correlation(covariance([series, series.map((value) => value * 3)]))[0]?.[1])
      .toBeCloseTo(1, 6);
    expect(correlation(covariance([series, series.map((value) => -value)]))[0]?.[1])
      .toBeCloseTo(-1, 6);
  });

  it('gives calmer assets more inverse-volatility weight', () => {
    const random = rng(7);
    const calm = Array.from({ length: 250 }, () => (random() - 0.5) * 0.01);
    const wild = Array.from({ length: 250 }, () => (random() - 0.5) * 0.04);
    const weights = inverseVolWeights([calm, wild]);
    expect(sum(weights)).toBeCloseTo(1, 6);
    expect(weights[0]!).toBeGreaterThan(weights[1]!);
    expect(weights[0]! / weights[1]!).toBeGreaterThan(2.5);
  });

  it('keeps tight single-linkage clusters contiguous', () => {
    const distances = [
      [0, 0.1, 1, 1],
      [0.1, 0, 1, 1],
      [1, 1, 0, 0.1],
      [1, 1, 0.1, 0],
    ];
    const order = quasiDiag(singleLinkage(distances), 4);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    const position = new Map(order.map((value, index) => [value, index]));
    expect(Math.abs(position.get(0)! - position.get(1)!)).toBe(1);
    expect(Math.abs(position.get(2)! - position.get(3)!)).toBe(1);
  });
});

describe('HRP and top-level risk budgets', () => {
  it('downweights a redundant correlated pair versus an independent asset', () => {
    const random = rng(42);
    const factor = Array.from({ length: 300 }, () => (random() - 0.5) * 0.04);
    const independent = Array.from({ length: 300 }, () => (random() - 0.5) * 0.04);
    const twin = factor.map((value) => value + (random() - 0.5) * 0.002);
    const weights = hrpWeights([factor, twin, independent]);
    expect(sum(weights)).toBeCloseTo(1, 6);
    expect(weights[2]!).toBeGreaterThan(weights[0]!);
    expect(weights[2]!).toBeGreaterThan(weights[1]!);
    expect(weights[2]!).toBeGreaterThan(inverseVolWeights([factor, twin, independent])[2]!);
    expect(hrpWeights([[0.01, 0.02, -0.01]])).toEqual([1]);
  });

  it('returns a simplex for sufficient closes and null otherwise', () => {
    const walk = (seed: number, count: number, scale: number): number[] => {
      const random = rng(seed);
      let price = 100;
      const closes = [price];
      for (let index = 0; index < count; index++) {
        price *= 1 + (random() - 0.5) * scale;
        closes.push(price);
      }
      return closes;
    };
    const weights = riskBudgetWeights(
      [walk(1, 120, 0.02), walk(2, 120, 0.06)],
      'inverse_vol',
    );
    expect(weights).not.toBeNull();
    expect(sum(weights!)).toBeCloseTo(1, 6);
    expect(weights![0]!).toBeGreaterThan(weights![1]!);
    expect(riskBudgetWeights([walk(1, 10, 0.02), walk(2, 10, 0.02)], 'hrp')).toBeNull();
    expect(riskBudgetWeights([walk(1, 120, 0.02)], 'hrp')).toBeNull();
    expect(alignReturns([walk(1, 60, 0.02), [100, 101, 102]], 30)).toBeNull();
  });
});
