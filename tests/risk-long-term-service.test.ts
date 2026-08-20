import { describe, expect, it, vi } from 'vitest';

import { FixedClock, type LongTermParams } from '../packages/core/src/index.js';
import {
  LongTermRiskService,
  type LongTermPriceObservation,
  type LongTermRiskInput,
} from '../packages/services/src/index.js';

const DAY_MS = 86_400_000;
const PARAMS: LongTermParams = {
  trendPeriod: 5,
  fastPeriod: 3,
  rsiPeriod: 3,
  rsiOversold: 30,
  rsiOverbought: 70,
  volLookback: 3,
  volatileThresholdPct: 80,
};

function observations(closes: readonly string[]): LongTermPriceObservation[] {
  return closes.map((closeUsd, index) => ({
    endTimeMs: (index + 1) * DAY_MS,
    closeUsd,
    source: 'coinbase',
    quality: 'venue_reported',
    complete: true,
  }));
}

function input(overrides: Partial<LongTermRiskInput> = {}): LongTermRiskInput {
  return {
    sourceDatasetHash: 'a'.repeat(64),
    instrument: { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
    observations: observations(['100', '101', '102', '100', '98', '90', '85', '80', '75', '70.000']),
    params: { ...PARAMS },
    ...overrides,
  };
}

describe('long-term risk service', () => {
  it('returns a provenance-bound advisory assessment from explicit parameters', () => {
    const callerInput = input();
    const service = new LongTermRiskService({ clock: new FixedClock(11 * DAY_MS) });
    const result = service.assess(callerInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected valid long-term assessment');

    expect(result.report).toEqual(expect.objectContaining({
      schemaVersion: 1,
      assessedAtMs: 11 * DAY_MS,
      sourceDatasetHash: 'a'.repeat(64),
      seriesHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      paramsHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      instrumentKey: 'coinbase|spot|BTC-USD',
      lastObservedAtMs: 10 * DAY_MS,
      observationAgeMs: DAY_MS,
      observationCount: 10,
      status: 'assessed',
      action: 'exit',
      reasonCode: 'trend_broken',
      priceUsd: '70.000',
      bull: false,
      orderIntentCreated: false,
      liveExecutionPermitted: false,
      assessmentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(result.report).not.toHaveProperty('rationale');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.report)).toBe(true);

    const originalHash = result.report.assessmentHash;
    (callerInput.observations[0] as { closeUsd: string }).closeUsd = '999';
    (callerInput.params as { trendPeriod: number }).trendPeriod = 9;
    expect(result.report.assessmentHash).toBe(originalHash);
  });

  it('reports insufficient history without choosing implicit default parameters', () => {
    const service = new LongTermRiskService({ clock: new FixedClock(3 * DAY_MS) });
    const result = service.assess(input({ observations: observations(['100', '101']) }));
    expect(result).toEqual({
      ok: true,
      report: expect.objectContaining({
        status: 'insufficient_history',
        action: 'hold',
        reasonCode: 'insufficient_history',
        trendSma: null,
        rsi: null,
        orderIntentCreated: false,
        liveExecutionPermitted: false,
      }),
    });

    const missingParams = service.assess({ ...input(), params: {} } as LongTermRiskInput);
    expect(missingParams.ok).toBe(false);
    if (missingParams.ok) throw new Error('explicit parameters should be required');
    expect(missingParams.issues.map((entry) => entry.code)).toEqual([
      'unknown_field',
      'invalid_trend_period',
      'invalid_fast_period',
      'invalid_rsi_period',
      'invalid_rsi_bounds',
      'invalid_volatility_lookback',
      'invalid_volatility_threshold',
    ]);
  });

  it('collects malformed provenance and observation issues before reading time', () => {
    const nowMs = vi.fn(() => 99 * DAY_MS);
    const service = new LongTermRiskService({ clock: { nowMs } });
    const malformed = {
      ...input(),
      sourceDatasetHash: 'bad-hash',
      instrument: { venue: 'coingecko', productId: 'bitcoin', productType: 'spot' },
      observations: [{
        endTimeMs: -1,
        closeUsd: '0',
        source: 'reference',
        quality: 'reference_market',
        complete: false,
        diagnostic: 'secret-bearing value',
      }],
      params: {},
      diagnostic: 'another secret-bearing value',
    } as unknown as LongTermRiskInput;
    const result = service.assess(malformed);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected validation failure');

    expect(result.issues.map((entry) => entry.code)).toEqual([
      'unknown_field',
      'invalid_dataset_hash',
      'invalid_instrument',
      'invalid_observation_shape',
      'invalid_observation_time',
      'invalid_close_price',
      'invalid_price_source',
      'incomplete_observation',
      'unknown_field',
      'invalid_trend_period',
      'invalid_fast_period',
      'invalid_rsi_period',
      'invalid_rsi_bounds',
      'invalid_volatility_lookback',
      'invalid_volatility_threshold',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-bearing');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(nowMs).not.toHaveBeenCalled();
  });

  it('rejects future and non-monotonic observations with stable codes', () => {
    const futureClock = new FixedClock(9 * DAY_MS);
    const future = new LongTermRiskService({ clock: futureClock }).assess(input());
    expect(future).toEqual({
      ok: false,
      issues: [{ path: ['observations'], code: 'future_observation' }],
    });

    const unordered = observations(['100', '101', '102']);
    unordered[2] = { ...unordered[2]!, endTimeMs: unordered[1]!.endTimeMs };
    const result = new LongTermRiskService({ clock: new FixedClock(10 * DAY_MS) })
      .assess(input({ observations: unordered }));
    expect(result).toEqual({
      ok: false,
      issues: [{
        path: ['observations', '2', 'endTimeMs'],
        code: 'non_monotonic_observations',
      }],
    });
  });
});
