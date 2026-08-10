import { describe, expect, it } from 'vitest';

import { combinatoriallySymmetricCrossValidation } from '../packages/core/src/index.js';

describe('combinatorially symmetric cross-validation', () => {
  it('reports zero PBO when the in-sample winner remains best out of sample', () => {
    const leader = Array.from({ length: 32 }, (_, index) => index % 2 === 0 ? 0.02 : 0);
    const laggard = Array.from({ length: 32 }, (_, index) => index % 2 === 0 ? 0.01 : -0.002);
    const result = combinatoriallySymmetricCrossValidation([leader, laggard], 4);
    expect(result.status).toBe('available');
    expect(result.combinationCount).toBe(6);
    expect(result.probabilityOfBacktestOverfitting).toBe(0);
    expect(result.splits.every((split) => split.logit > 0)).toBe(true);
  });

  it('detects a partition-specific winner that fails on its complement', () => {
    const candidates = Array.from({ length: 4 }, (_, candidate) =>
      Array.from({ length: 32 }, (_, row) => {
        const partition = Math.floor(row / 8);
        const noise = row % 2 === 0 ? 0.005 : -0.005;
        return partition === candidate ? 0.03 + noise : -0.01 + noise;
      }));
    const result = combinatoriallySymmetricCrossValidation(candidates, 4);
    expect(result.status).toBe('available');
    expect(result.probabilityOfBacktestOverfitting).toBe(1);
    expect(result.probabilityOfOutOfSampleLoss).toBe(1);
    expect(result.splits.every((split) => split.logit < 0)).toBe(true);
  });

  it('deterministically drops only the oldest equal-partition remainder', () => {
    const columns = [
      Array.from({ length: 34 }, (_, index) => 0.01 + (index % 2) * 0.001),
      Array.from({ length: 34 }, (_, index) => 0.005 - (index % 2) * 0.001),
    ];
    const result = combinatoriallySymmetricCrossValidation(columns, 4);
    expect(result.usableObservationCount).toBe(32);
    expect(result.droppedOldestObservations).toBe(2);
    expect(result).toEqual(combinatoriallySymmetricCrossValidation(columns, 4));
  });

  it('states insufficiency instead of manufacturing a statistic', () => {
    expect(combinatoriallySymmetricCrossValidation([[0.1, 0.2]], 4))
      .toEqual(expect.objectContaining({
        status: 'insufficient-data',
        probabilityOfBacktestOverfitting: null,
      }));
    expect(combinatoriallySymmetricCrossValidation([
      [0.1, 0.2, 0.3, 0.4],
      [0.1, 0.2],
    ], 4).reason).toMatch(/synchronous/u);
  });
});
