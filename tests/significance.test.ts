import { describe, expect, it } from 'vitest';
import {
  deflatedSharpe,
  deflatedSharpeForTrials,
  expectedMaxSharpe,
  moments,
  normalCdf,
  normalInv,
  periodSharpe,
  probabilisticSharpe,
  stddev,
} from '../packages/core/src/significance/index.js';

describe('normalCdf / normalInv', () => {
  it('Φ matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 4);
  });
  it('inverse matches known quantiles and round-trips', () => {
    expect(normalInv(0.5)).toBeCloseTo(0, 6);
    expect(normalInv(0.975)).toBeCloseTo(1.959964, 3);
    expect(normalCdf(normalInv(0.9))).toBeCloseTo(0.9, 4);
  });
});

describe('moments', () => {
  it('symmetric data → ~0 skew, ~ mesokurtic', () => {
    const xs = [-2, -1, 0, 1, 2];
    const { skew, kurt } = moments(xs);
    expect(skew).toBeCloseTo(0, 6);
    expect(kurt).toBeGreaterThan(1);
  });
  it('right-skewed data → positive skew', () => {
    const { skew } = moments([0, 0, 0, 0, 10]);
    expect(skew).toBeGreaterThan(0);
  });
});

describe('probabilisticSharpe', () => {
  it('equals 0.5 when observed Sharpe equals the benchmark', () => {
    expect(probabilisticSharpe(0.1, 250, 0, 3, 0.1)!).toBeCloseTo(0.5, 6);
  });
  it('rises with observed Sharpe and with sample length', () => {
    const small = probabilisticSharpe(0.1, 60, 0, 3, 0)!;
    const big = probabilisticSharpe(0.1, 600, 0, 3, 0)!;
    expect(big).toBeGreaterThan(small); // more data → more confident
    const higher = probabilisticSharpe(0.2, 250, 0, 3, 0)!;
    const lower = probabilisticSharpe(0.05, 250, 0, 3, 0)!;
    expect(higher).toBeGreaterThan(lower);
  });
  it('null when sample too small', () => {
    expect(probabilisticSharpe(0.1, 1, 0, 3, 0)).toBeNull();
  });
});

describe('expectedMaxSharpe', () => {
  it('is 0 with a single trial or no dispersion', () => {
    expect(expectedMaxSharpe(0.1, 1)).toBe(0);
    expect(expectedMaxSharpe(0, 10)).toBe(0);
  });
  it('grows with the number of trials', () => {
    const few = expectedMaxSharpe(0.1, 3);
    const many = expectedMaxSharpe(0.1, 50);
    expect(many).toBeGreaterThan(few);
    expect(few).toBeGreaterThan(0);
  });
});

describe('deflatedSharpe', () => {
  it('is stricter than the naive PSR-vs-0 (deflation raises the bar)', () => {
    const trials = [0.02, 0.05, 0.08, 0.12]; // four raced strategies (daily Sharpes)
    const leader = 0.12;
    const psr = probabilisticSharpe(leader, 250, 0, 3, 0)!;
    const dsr = deflatedSharpe(leader, 250, 0, 3, trials)!;
    expect(dsr).toBeLessThan(psr); // searching many strategies must lower confidence
    expect(dsr).toBeGreaterThanOrEqual(0);
    expect(dsr).toBeLessThanOrEqual(1);
  });
  it('a strong, long-sample leader over a tight field can still clear a high bar', () => {
    const trials = [0.14, 0.15, 0.16, 0.40]; // one clear standout
    const dsr = deflatedSharpe(0.4, 2000, 0, 3, trials)!;
    expect(dsr).toBeGreaterThan(0.9);
  });
  it('null when there are no trials', () => {
    expect(deflatedSharpe(0.1, 250, 0, 3, [])).toBeNull();
  });
});

describe('deflatedSharpeForTrials', () => {
  it('uses the registered count without padding the observed field with zeros', () => {
    const observed = [0.02, 0.05, 0.08, 0.12];
    const few = deflatedSharpeForTrials(0.12, 250, 0, 3, observed, 4)!;
    const many = deflatedSharpeForTrials(0.12, 250, 0, 3, observed, 180)!;
    expect(many).toBeLessThan(few);
  });

  it('rejects an invalid registered count', () => {
    expect(deflatedSharpeForTrials(0.1, 250, 0, 3, [0.1], 0)).toBeNull();
  });
});

describe('periodSharpe', () => {
  it('mean over std of a return series', () => {
    const r = [0.01, 0.02, -0.01, 0.03, 0.0];
    expect(periodSharpe(r)!).toBeCloseTo(mean(r) / stddev(r, 1), 6);
  });
  it('null on flat series', () => {
    expect(periodSharpe([0.01, 0.01, 0.01])).toBeNull();
  });
});

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
