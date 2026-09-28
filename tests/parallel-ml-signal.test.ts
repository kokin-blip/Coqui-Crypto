import { describe, expect, it } from 'vitest';

import { ML_SIGNAL_VERSION, predictMlSignal, proposeMlTarget, trainMlSignal,
  type MlSignalRow } from '../packages/core/src/index.js';
import { evaluateParallelMlSignal, verifyParallelMlExecutionPath } from '../packages/services/src/index.js';
import { finishMlSignalStudy, getMlSignalStudy, listMlHourlyBars, openDatabase,
  registerMlSignalStudy, saveMlHourlyBars, type MlHourlyBar } from '../packages/storage/src/index.js';
import { sha256Hex } from '../packages/core/src/index.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function row(index: number): MlSignalRow {
  const features = [0, 1, 2].map((asset) => {
    const value = Math.sin(index / 5 + asset);
    return [value, value / 2, value / 3, Math.abs(value) / 8, value / 4];
  });
  return { atMs: index * 4 * HOUR, features,
    forwardReturns: features.map((item) => 0.02 * item[0]! - 0.01 * item[1]!),
    baseline: [0.2, 0.2, 0.2] };
}

function bars(days: number): MlHourlyBar[] {
  const start = Date.UTC(2025, 0, 1);
  return Array.from({ length: days * 24 }, (_, hour) =>
    (['BTC-USD', 'ETH-USD', 'LTC-USD'] as const).map((productId, asset) => {
      const price = 100 * (asset + 1) * (1 + hour / 100_000);
      return { productId, startTimeMs: start + hour * HOUR,
        open: String(price), high: String(price * 1.001), low: String(price * 0.999),
        close: String(price * 1.0001), volume: '100', source: 'authenticated' as const,
        retrievedAtMs: start + days * DAY };
    })).flat();
}

describe('bounded ML signal worker', () => {
  it('passes an in-memory order, duplicate-slot, and partial-fill integration check', async () => {
    expect(await verifyParallelMlExecutionPath()).toBe(true);
  });
  it('fits and predicts reproducibly without depending on a broker', () => {
    const training = Array.from({ length: 600 }, (_, index) => row(index));
    const first = trainMlSignal(training);
    const second = trainMlSignal(training);
    expect(first).toEqual(second);
    expect(first.version).toBe(ML_SIGNAL_VERSION);
    expect(predictMlSignal(first, row(601).features)).toEqual(predictMlSignal(second, row(601).features));
    expect(() => predictMlSignal(first, [[NaN], [], []])).toThrow('ml_prediction_invalid');
  });

  it('never exceeds the target bounds and leaves weak predictions alone', () => {
    expect(proposeMlTarget([0.2, 0.2, 0.2], [0, 0, 0]).weights).toEqual([0.2, 0.2, 0.2]);
    const proposal = proposeMlTarget([0.2, 0.2, 0.2], [0.2, -0.2, 0.01]);
    expect(proposal.turnover).toBeGreaterThan(0);
    expect(proposal.weights.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(0.7);
    proposal.weights.forEach((weight) => {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(Math.abs(weight - 0.2)).toBeLessThanOrEqual(0.100000001);
    });
    expect(() => proposeMlTarget([0.8, 0.5, 0], [1, 2, 3])).toThrow('ml_target_invalid');
  });

  it('keeps missing history in collection and records a nonpositive holdout as shadow', () => {
    const short = bars(120);
    const now = Date.UTC(2025, 0, 1) + 120 * DAY;
    expect(evaluateParallelMlSignal({ bars: short, nowMs: now, studyEndMs: now,
      functionalChecksPassed: true }).gate).toBe('collecting');
    const complete = bars(400);
    const end = Date.UTC(2025, 0, 1) + 400 * DAY;
    const result = evaluateParallelMlSignal({ bars: complete, nowMs: end,
      studyEndMs: end, functionalChecksPassed: true });
    expect(result.evidence?.holdoutSlots).toBeGreaterThan(400);
    expect(result.gate).toBe('unqualified');
  });

  it('keeps hourly research data profile scoped and freezes the first study result', () => {
    const db = openDatabase(':memory:');
    const sample = bars(1).slice(0, 3);
    saveMlHourlyBars('main', sample, db);
    expect(listMlHourlyBars('other', sample[0]!.startTimeMs,
      sample[0]!.startTimeMs + HOUR, db)).toEqual([]);
    expect(listMlHourlyBars('main', sample[0]!.startTimeMs,
      sample[0]!.startTimeMs + HOUR, db)).toHaveLength(3);
    const registration = { profileId: 'main', candidateVersion: ML_SIGNAL_VERSION,
      registeredAtMs: 123, studyEndMs: 456, datasetHash: sha256Hex('data'),
      planHash: sha256Hex('plan'), plan: { candidateCount: 1 } };
    registerMlSignalStudy(registration, db);
    finishMlSignalStudy('main', ML_SIGNAL_VERSION, { gate: 'unqualified' }, db);
    expect(getMlSignalStudy('main', ML_SIGNAL_VERSION, db)?.result).toEqual({ gate: 'unqualified' });
    expect(() => db.prepare('UPDATE ml_signal_studies_v1 SET result_json=? WHERE profile_id=?')
      .run('{"gate":"qualified"}', 'main')).toThrow('immutable');
    db.close();
  });
});
