import { describe, expect, it } from 'vitest';
import {
  mulberry32,
  jointDailyReturns,
  stationaryBootstrapIndices,
  syntheticMarket,
  bootstrapExcessPValue,
} from '../packages/core/src/validation/monte-carlo.js';

describe('mulberry32', () => {
  it('is deterministic per seed and uniform-ish in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    const c = mulberry32(8);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(seqA);
    const r = mulberry32(1);
    for (let i = 0; i < 1000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('jointDailyReturns', () => {
  it('aligns tails and computes per-day joint return rows', () => {
    const j = jointDailyReturns({ A: [100, 110, 121], B: [50, 50, 55, 55, 66] });
    expect(j.ids).toEqual(['A', 'B']);
    // B trimmed to its last 3 closes [55, 55, 66]; A stays [100, 110, 121].
    expect(j.returns).toHaveLength(2);
    expect(j.returns[0]![0]).toBeCloseTo(0.1, 9); // A day 1
    expect(j.returns[0]![1]).toBeCloseTo(0, 9); // B day 1
    expect(j.returns[1]![1]).toBeCloseTo(0.2, 9); // B day 2
    expect(j.firstCloses).toEqual([100, 55]);
  });
});

describe('stationaryBootstrapIndices', () => {
  it('produces n in-range indices with contiguous runs (blocks)', () => {
    const rand = mulberry32(3);
    const idx = stationaryBootstrapIndices(50, 500, 20, rand);
    expect(idx).toHaveLength(500);
    for (const i of idx) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(50);
    }
    // With mean block length 20, most steps continue the previous index (+1 mod n).
    let contiguous = 0;
    for (let k = 1; k < idx.length; k++) if (idx[k] === (idx[k - 1]! + 1) % 50) contiguous += 1;
    expect(contiguous / (idx.length - 1)).toBeGreaterThan(0.8);
  });
});

describe('syntheticMarket', () => {
  it('builds equal-length positive series sharing the same sampled days', () => {
    // A and B move in lockstep (perfect correlation) — synthetic paths must too.
    const closes = {
      A: Array.from({ length: 60 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i))),
      B: Array.from({ length: 60 }, (_, i) => 200 * (1 + 0.01 * Math.sin(i))),
    };
    const joint = jointDailyReturns(closes);
    const synth = syntheticMarket(joint, 40, 10, mulberry32(9));
    expect(synth['A']).toHaveLength(41);
    expect(synth['B']).toHaveLength(41);
    for (let t = 1; t < 41; t++) {
      const ra = synth['A']![t]! / synth['A']![t - 1]! - 1;
      const rb = synth['B']![t]! / synth['B']![t - 1]! - 1;
      expect(ra).toBeCloseTo(rb, 9); // same day sampled for both assets
      expect(synth['A']![t]!).toBeGreaterThan(0);
    }
  });
});

describe('bootstrapExcessPValue', () => {
  it('finds a real edge significant and a zero edge insignificant', () => {
    const rand = mulberry32(11);
    const n = 500;
    const bench = Array.from({ length: n }, () => (rand() - 0.5) * 0.02);
    // Strategy = benchmark + steady 8bp/day edge → tiny p-value.
    const withEdge = bench.map((r) => r + 0.0008);
    const sig = bootstrapExcessPValue(withEdge, bench, { resamples: 500, seed: 1 });
    expect(sig.observedMeanExcess).toBeCloseTo(0.0008, 6);
    expect(sig.pValue).toBeLessThan(0.05);
    // Strategy = an independent same-distribution series → p not small.
    const rand2 = mulberry32(12);
    const noEdge = Array.from({ length: n }, () => (rand2() - 0.5) * 0.02);
    const ns = bootstrapExcessPValue(noEdge, bench, { resamples: 500, seed: 1 });
    expect(ns.pValue).toBeGreaterThan(0.05);
  });

  it('degrades on short samples', () => {
    const r = bootstrapExcessPValue([0.01], [0], {});
    expect(r.pValue).toBe(1);
    expect(r.resamples).toBe(0);
  });
});
