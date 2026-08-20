import {
  evaluateLongTerm,
  instrumentKey,
  nonNegativeDecimal,
  sha256Hex,
  type Clock,
  type InstrumentIdentity,
  type LongTermAction,
  type LongTermParams,
  type MarketRegime,
} from '@coqui/core';

import { freezeRiskValue } from './immutable.js';

const HASH = /^[a-f0-9]{64}$/u;
const COINBASE_USD_PRODUCT = /^[A-Z0-9][A-Z0-9-]{0,29}-USD$/u;
const INPUT_KEYS = ['sourceDatasetHash', 'instrument', 'observations', 'params'] as const;
const INSTRUMENT_KEYS = ['venue', 'productId', 'productType'] as const;
const OBSERVATION_KEYS = ['endTimeMs', 'closeUsd', 'source', 'quality', 'complete'] as const;
const PARAM_KEYS = [
  'trendPeriod', 'fastPeriod', 'rsiPeriod', 'rsiOversold', 'rsiOverbought',
  'volLookback', 'volatileThresholdPct',
] as const;
const MAX_OBSERVATIONS = 5_000;

export interface LongTermPriceObservation {
  readonly endTimeMs: number;
  readonly closeUsd: string;
  readonly source: 'coinbase';
  readonly quality: 'venue_reported';
  readonly complete: true;
}

export interface LongTermRiskInput {
  readonly sourceDatasetHash: string;
  readonly instrument: InstrumentIdentity;
  readonly observations: readonly LongTermPriceObservation[];
  readonly params: LongTermParams;
}

export type LongTermRiskValidationCode =
  | 'unknown_field'
  | 'invalid_dataset_hash'
  | 'invalid_instrument'
  | 'invalid_observation_count'
  | 'invalid_observation_shape'
  | 'invalid_observation_time'
  | 'non_monotonic_observations'
  | 'invalid_close_price'
  | 'invalid_price_source'
  | 'incomplete_observation'
  | 'invalid_trend_period'
  | 'invalid_fast_period'
  | 'invalid_rsi_period'
  | 'invalid_rsi_bounds'
  | 'invalid_volatility_lookback'
  | 'invalid_volatility_threshold'
  | 'future_observation';

export interface LongTermRiskValidationIssue {
  readonly path: readonly string[];
  readonly code: LongTermRiskValidationCode;
}

export type LongTermReasonCode =
  | 'insufficient_history'
  | 'trend_broken'
  | 'overbought_uptrend'
  | 'oversold_pullback'
  | 'healthy_uptrend';

export interface LongTermRiskReport {
  readonly schemaVersion: 1;
  readonly assessedAtMs: number;
  readonly sourceDatasetHash: string;
  readonly seriesHash: string;
  readonly paramsHash: string;
  readonly instrumentKey: string;
  readonly lastObservedAtMs: number;
  readonly observationAgeMs: number;
  readonly observationCount: number;
  readonly status: 'assessed' | 'insufficient_history';
  readonly action: LongTermAction;
  readonly reasonCode: LongTermReasonCode;
  readonly regime: MarketRegime;
  readonly priceUsd: string;
  readonly fastSma: number | null;
  readonly trendSma: number | null;
  readonly rsi: number | null;
  readonly pctFromTrend: number | null;
  readonly volatilityPct: number | null;
  readonly bull: boolean;
  readonly orderIntentCreated: false;
  readonly liveExecutionPermitted: false;
  readonly assessmentHash: string;
}

export type LongTermRiskResult =
  | { readonly ok: true; readonly report: LongTermRiskReport }
  | { readonly ok: false; readonly issues: readonly LongTermRiskValidationIssue[] };

export interface LongTermRiskDependencies {
  readonly clock: Clock;
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    [...expected].sort().every((key, index) => actual[index] === key);
}

function issue(path: readonly string[], code: LongTermRiskValidationCode): LongTermRiskValidationIssue {
  return freezeRiskValue({ path: [...path], code });
}

function validPeriod(value: unknown, maximum = 5_000): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 2 && (value as number) <= maximum;
}

function validate(input: LongTermRiskInput): readonly LongTermRiskValidationIssue[] {
  const issues: LongTermRiskValidationIssue[] = [];
  if (!exactKeys(input, INPUT_KEYS)) issues.push(issue([], 'unknown_field'));
  if (typeof input.sourceDatasetHash !== 'string' || !HASH.test(input.sourceDatasetHash)) {
    issues.push(issue(['sourceDatasetHash'], 'invalid_dataset_hash'));
  }
  let validInstrument = exactKeys(input.instrument, INSTRUMENT_KEYS);
  if (validInstrument) {
    try {
      instrumentKey(input.instrument);
    } catch {
      validInstrument = false;
    }
  }
  if (!validInstrument || input.instrument?.venue !== 'coinbase' ||
      input.instrument?.productType !== 'spot' ||
      typeof input.instrument?.productId !== 'string' ||
      !COINBASE_USD_PRODUCT.test(input.instrument.productId)) {
    issues.push(issue(['instrument'], 'invalid_instrument'));
  }
  if (!Array.isArray(input.observations) || input.observations.length === 0 ||
      input.observations.length > MAX_OBSERVATIONS) {
    issues.push(issue(['observations'], 'invalid_observation_count'));
  } else {
    let previousTime = -1;
    input.observations.forEach((observation, index) => {
      const path = ['observations', String(index)];
      if (!exactKeys(observation, OBSERVATION_KEYS)) {
        issues.push(issue(path, 'invalid_observation_shape'));
      }
      if (observation === null || typeof observation !== 'object' || Array.isArray(observation)) {
        return;
      }
      if (!Number.isSafeInteger(observation.endTimeMs) || observation.endTimeMs < 0) {
        issues.push(issue([...path, 'endTimeMs'], 'invalid_observation_time'));
      } else {
        if (observation.endTimeMs <= previousTime) {
          issues.push(issue([...path, 'endTimeMs'], 'non_monotonic_observations'));
        }
        previousTime = observation.endTimeMs;
      }
      let validClose: boolean;
      try {
        const decimal = nonNegativeDecimal(observation.closeUsd);
        const numeric = Number(decimal);
        validClose = numeric > 0 && Number.isFinite(numeric);
      } catch {
        validClose = false;
      }
      if (!validClose) issues.push(issue([...path, 'closeUsd'], 'invalid_close_price'));
      if (observation.source !== 'coinbase' || observation.quality !== 'venue_reported') {
        issues.push(issue([...path, 'source'], 'invalid_price_source'));
      }
      if (observation.complete !== true) {
        issues.push(issue([...path, 'complete'], 'incomplete_observation'));
      }
    });
  }
  const params = (input.params ?? {}) as Partial<LongTermParams>;
  if (!exactKeys(input.params, PARAM_KEYS)) issues.push(issue(['params'], 'unknown_field'));
  if (!validPeriod(params.trendPeriod)) {
    issues.push(issue(['params', 'trendPeriod'], 'invalid_trend_period'));
  }
  if (!validPeriod(params.fastPeriod) ||
      (validPeriod(params.trendPeriod) && params.fastPeriod >= params.trendPeriod)) {
    issues.push(issue(['params', 'fastPeriod'], 'invalid_fast_period'));
  }
  if (!validPeriod(params.rsiPeriod, 1_000)) {
    issues.push(issue(['params', 'rsiPeriod'], 'invalid_rsi_period'));
  }
  if (typeof params.rsiOversold !== 'number' ||
      typeof params.rsiOverbought !== 'number' ||
      !Number.isFinite(params.rsiOversold) || !Number.isFinite(params.rsiOverbought) ||
      params.rsiOversold < 0 || params.rsiOverbought > 100 ||
      params.rsiOversold >= params.rsiOverbought) {
    issues.push(issue(['params', 'rsiOversold'], 'invalid_rsi_bounds'));
  }
  if (!validPeriod(params.volLookback)) {
    issues.push(issue(['params', 'volLookback'], 'invalid_volatility_lookback'));
  }
  if (typeof params.volatileThresholdPct !== 'number' ||
      !Number.isFinite(params.volatileThresholdPct) ||
      params.volatileThresholdPct <= 0 || params.volatileThresholdPct > 1_000) {
    issues.push(issue(['params', 'volatileThresholdPct'], 'invalid_volatility_threshold'));
  }
  return freezeRiskValue(issues);
}

function reasonCode(
  action: LongTermAction,
  bull: boolean,
  insufficient: boolean,
): LongTermReasonCode {
  if (insufficient) return 'insufficient_history';
  if (!bull) return 'trend_broken';
  if (action === 'trim') return 'overbought_uptrend';
  if (action === 'accumulate') return 'oversold_pullback';
  return 'healthy_uptrend';
}

/** Explicit-parameter, Coinbase-only long-term risk assessment. */
export class LongTermRiskService {
  readonly #clock: Clock;

  constructor(dependencies: LongTermRiskDependencies) {
    this.#clock = dependencies.clock;
  }

  assess(input: LongTermRiskInput): LongTermRiskResult {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return freezeRiskValue({ ok: false, issues: [issue([], 'unknown_field')] });
    }
    const issues = validate(input);
    if (issues.length > 0) return freezeRiskValue({ ok: false, issues });
    const assessedAtMs = this.#clock.nowMs();
    if (!Number.isSafeInteger(assessedAtMs) || assessedAtMs < 0) {
      throw new RangeError('Risk clock must return a non-negative safe epoch millisecond.');
    }
    const last = input.observations.at(-1)!;
    if (last.endTimeMs > assessedAtMs) {
      return freezeRiskValue({
        ok: false,
        issues: [issue(['observations'], 'future_observation')],
      });
    }
    const closes = input.observations.map((observation) => Number(observation.closeUsd));
    const assessment = evaluateLongTerm(closes, input.params);
    const insufficient = assessment.trendSma === null || assessment.rsi === null;
    const seriesIdentity = {
      instrument: input.instrument,
      observations: input.observations.map((observation) => ({ ...observation })),
    };
    const seriesHash = sha256Hex(JSON.stringify(seriesIdentity));
    const paramsHash = sha256Hex(JSON.stringify(input.params));
    const withoutHash = {
      schemaVersion: 1 as const,
      assessedAtMs,
      sourceDatasetHash: input.sourceDatasetHash,
      seriesHash,
      paramsHash,
      instrumentKey: instrumentKey(input.instrument),
      lastObservedAtMs: last.endTimeMs,
      observationAgeMs: assessedAtMs - last.endTimeMs,
      observationCount: input.observations.length,
      status: insufficient ? 'insufficient_history' as const : 'assessed' as const,
      action: assessment.action,
      reasonCode: reasonCode(assessment.action, assessment.bull, insufficient),
      regime: assessment.regime,
      priceUsd: last.closeUsd,
      fastSma: assessment.fastSma,
      trendSma: assessment.trendSma,
      rsi: assessment.rsi,
      pctFromTrend: assessment.pctFromTrend,
      volatilityPct: assessment.volatilityPct,
      bull: assessment.bull,
      orderIntentCreated: false as const,
      liveExecutionPermitted: false as const,
    };
    return freezeRiskValue({
      ok: true,
      report: { ...withoutHash, assessmentHash: sha256Hex(JSON.stringify(withoutHash)) },
    });
  }
}
