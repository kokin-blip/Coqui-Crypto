import { describe, expect, it } from 'vitest';
import {
  createLongTermSignalEvaluator,
  DEFAULT_LONG_TERM_PARAMS,
  evaluateLongTerm,
} from '../packages/core/src/index.js';

function series(base: number, tail: number[]): number[] {
  return [...Array.from({ length: 220 - tail.length }, () => base), ...tail];
}

function rampThenDip(
  rampDays: number,
  rampStep: number,
  dipDays: number,
  dipStep: number,
): number[] {
  const closes: number[] = [];
  let value = 50;
  for (let index = 0; index < rampDays; index++) {
    closes.push(value);
    value += rampStep;
  }
  for (let index = 0; index < dipDays; index++) {
    value -= dipStep;
    closes.push(value);
  }
  return closes;
}

describe('evaluateLongTerm', () => {
  it('exits below the long-term trend', () => {
    const assessment = evaluateLongTerm(series(100, [80, 79, 78, 77, 76]));
    expect(assessment.bull).toBe(false);
    expect(assessment.action).toBe('exit');
  });

  it('accumulates an RSI pullback that remains above trend', () => {
    const assessment = evaluateLongTerm(rampThenDip(210, 2, 16, 6));
    expect(assessment.bull).toBe(true);
    expect(assessment.rsi).toBeLessThanOrEqual(DEFAULT_LONG_TERM_PARAMS.rsiOversold);
    expect(assessment.action).toBe('accumulate');
  });

  it('trims an overbought uptrend and holds a neutral one', () => {
    expect(evaluateLongTerm(series(100, [120, 124, 129, 135, 142, 150, 160])).action)
      .toBe('trim');
    const neutral = Array.from({ length: 20 }, (_, index) => 120 + (index % 2 === 0 ? 1 : -1));
    expect(evaluateLongTerm(series(100, neutral)).action).toBe('hold');
  });

  it('holds with an explicit reason when history is insufficient', () => {
    const assessment = evaluateLongTerm([100, 101, 102]);
    expect(assessment.action).toBe('hold');
    expect(assessment.rationale).toMatch(/insufficient/i);
  });
});

describe('sentiment and volatility context', () => {
  function alternating(start: number, up: number, down: number, count = 35): number[] {
    let value = start;
    const tail = [value];
    for (let index = 0; index < count; index++) {
      value += index % 2 === 0 ? up : -down;
      tail.push(value);
    }
    return series(100, tail);
  }

  const fearHold = alternating(125, 0.8, 1.4);
  const greedHold = alternating(120, 1.5, 1);
  const volatileHold = alternating(120, 12, 12);

  it('keeps historical evaluation free of unavailable sentiment', () => {
    expect(evaluateLongTerm(fearHold).action).toBe('hold');
    expect(evaluateLongTerm(greedHold).action).toBe('hold');
    expect(evaluateLongTerm(volatileHold).action).toBe('hold');
  });

  it('nudges a neutral bull read only at contextual sentiment extremes', () => {
    expect(evaluateLongTerm(fearHold, DEFAULT_LONG_TERM_PARAMS, { fearGreed: 10 }).action)
      .toBe('accumulate');
    expect(evaluateLongTerm(greedHold, DEFAULT_LONG_TERM_PARAMS, { fearGreed: 90 }).action)
      .toBe('trim');
    expect(evaluateLongTerm(fearHold, DEFAULT_LONG_TERM_PARAMS, { fearGreed: 50 }).action)
      .toBe('hold');
  });

  it('does not override a broken trend and dampens sentiment in volatile tape', () => {
    expect(
      evaluateLongTerm(series(100, [80, 79, 78, 77, 76]), DEFAULT_LONG_TERM_PARAMS, {
        fearGreed: 5,
      }).action,
    ).toBe('exit');
    const volatile = evaluateLongTerm(volatileHold);
    expect(volatile.regime).toBe('volatile');
    expect(
      evaluateLongTerm(volatileHold, DEFAULT_LONG_TERM_PARAMS, { fearGreed: 10 }).action,
    ).toBe('hold');
  });
});

describe('createLongTermSignalEvaluator', () => {
  it('adapts the assessment to the shared backtest signal contract', () => {
    const closes = series(100, [80, 79, 78, 77, 76]);
    const assessment = evaluateLongTerm(closes);
    expect(createLongTermSignalEvaluator()(closes)).toEqual({
      action: assessment.action,
      rsi: assessment.rsi,
      regime: assessment.regime,
    });
  });
});
