import { describe, expect, it } from 'vitest';
import {
  FixedClock,
  ReplayClock,
  SystemClock,
  floorToUtcInterval,
  isBarComplete,
} from '../packages/core/src/index.js';

describe('Clock', () => {
  it('injects production time instead of reading host time from core', () => {
    const clock = new SystemClock(() => 1_700_000_000_000);
    expect(clock.nowMs()).toBe(1_700_000_000_000);
  });

  it('advances fixed time deterministically', () => {
    const clock = new FixedClock(1_000);
    clock.advanceBy(250);
    expect(clock.nowMs()).toBe(1_250);
    clock.set(2_000);
    expect(clock.nowMs()).toBe(2_000);
  });

  it('replays ordered market timestamps exactly once', () => {
    const clock = new ReplayClock([100, 200, 200, 400]);
    expect(clock.nowMs()).toBe(100);
    expect(clock.advance()).toBe(200);
    expect(clock.advance()).toBe(200);
    expect(clock.advance()).toBe(400);
    expect(clock.hasNext).toBe(false);
    expect(() => clock.advance()).toThrow(RangeError);
  });

  it('rejects a backwards replay timeline', () => {
    expect(() => new ReplayClock([200, 100])).toThrow(RangeError);
  });
});

describe('UTC interval math', () => {
  it('floors against the Unix epoch rather than local time', () => {
    const hour = 3_600_000;
    expect(floorToUtcInterval(1_700_001_234_567, hour)).toBe(1_699_999_200_000);
  });

  it('waits through a source completion delay', () => {
    const clock = new FixedClock(10_999);
    expect(isBarComplete(10_000, 1_000, clock)).toBe(false);
    clock.advanceBy(1);
    expect(isBarComplete(10_000, 1_000, clock)).toBe(true);
  });
});
