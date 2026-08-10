import { describe, expect, it } from 'vitest';

import { benchmarkRelativeConfidence } from '../packages/core/src/index.js';

const OPTIONS = {
  resamples: 1_000,
  meanBlockLength: 10,
  confidenceLevel: 0.95,
  seed: 42,
} as const;

describe('paired benchmark-relative confidence', () => {
  it('finds a stable paired edge with a positive lower confidence bound', () => {
    const benchmark = Array.from({ length: 300 }, (_, index) =>
      0.004 * Math.sin(index / 7) + 0.002 * Math.sin(index / 19));
    const strategy = benchmark.map((value, index) =>
      value + 0.0006 + 0.0001 * Math.sin(index / 11));
    const result = benchmarkRelativeConfidence(strategy, benchmark, OPTIONS);
    expect(result.status).toBe('available');
    expect(result.observedMeanDailyExcess).toBeGreaterThan(0);
    expect(result.lowerMeanDailyExcess).toBeGreaterThan(0);
    expect(result.oneSidedPValue).toBeLessThan(0.05);
    expect(result).toEqual(benchmarkRelativeConfidence(strategy, benchmark, OPTIONS));
  });

  it('does not promote a zero-mean dependent excess series', () => {
    const benchmark = Array.from({ length: 300 }, (_, index) => 0.005 * Math.sin(index / 9));
    const strategy = benchmark.map((value, index) => value + 0.002 * Math.sin(index / 5));
    const result = benchmarkRelativeConfidence(strategy, benchmark, OPTIONS);
    expect(result.status).toBe('available');
    expect(result.lowerMeanDailyExcess).toBeLessThanOrEqual(0);
    expect(result.upperMeanDailyExcess).toBeGreaterThanOrEqual(0);
  });

  it('fails closed for short, unpaired, or invalid samples', () => {
    expect(benchmarkRelativeConfidence([0.01], [0], OPTIONS).status)
      .toBe('insufficient-data');
    expect(benchmarkRelativeConfidence(Array(40).fill(0.01), Array(39).fill(0), OPTIONS).reason)
      .toMatch(/synchronous/u);
    expect(benchmarkRelativeConfidence(
      Array(40).fill(0.01),
      Array(40).fill(0),
      { ...OPTIONS, meanBlockLength: 41 },
    ).status).toBe('insufficient-data');
  });
});
