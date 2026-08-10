/** Time source shared by deterministic research, paper execution, and scheduling. */
export interface Clock {
  nowMs(): number;
}

function epochMs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Expected a non-negative safe epoch millisecond: ${value}`);
  }
  return value;
}

/**
 * Production clock whose system-time reader is supplied by the composition root.
 * Core never reaches into the host wall clock directly.
 */
export class SystemClock implements Clock {
  readonly #readSystemTime: () => number;

  constructor(readSystemTime: () => number) {
    this.#readSystemTime = readSystemTime;
  }

  nowMs(): number {
    return epochMs(this.#readSystemTime());
  }
}

/** Mutable deterministic clock for service and guardrail tests. */
export class FixedClock implements Clock {
  #currentMs: number;

  constructor(initialMs: number) {
    this.#currentMs = epochMs(initialMs);
  }

  nowMs(): number {
    return this.#currentMs;
  }

  set(nextMs: number): void {
    this.#currentMs = epochMs(nextMs);
  }

  advanceBy(durationMs: number): void {
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
      throw new RangeError(`Expected a non-negative safe duration: ${durationMs}`);
    }
    this.#currentMs = epochMs(this.#currentMs + durationMs);
  }
}

/** Clock that advances only across an immutable sequence of market timestamps. */
export class ReplayClock implements Clock {
  readonly #timeline: readonly number[];
  #index = 0;

  constructor(timeline: readonly number[]) {
    if (timeline.length === 0) throw new RangeError('A replay timeline cannot be empty');
    this.#timeline = timeline.map(epochMs);
    for (let index = 1; index < this.#timeline.length; index += 1) {
      const current = this.#timeline[index];
      const previous = this.#timeline[index - 1];
      if (current === undefined || previous === undefined) {
        throw new RangeError('A replay timeline cannot contain missing timestamps');
      }
      if (current < previous) {
        throw new RangeError('A replay timeline must be ordered');
      }
    }
  }

  nowMs(): number {
    return this.#timeline[this.#index] as number;
  }

  get hasNext(): boolean {
    return this.#index + 1 < this.#timeline.length;
  }

  advance(): number {
    if (!this.hasNext) throw new RangeError('The replay timeline is exhausted');
    this.#index += 1;
    return this.nowMs();
  }
}

/** Floor a timestamp to a UTC-aligned interval boundary. */
export function floorToUtcInterval(timeMs: number, intervalMs: number): number {
  const time = epochMs(timeMs);
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError(`Expected a positive safe interval: ${intervalMs}`);
  }
  return Math.floor(time / intervalMs) * intervalMs;
}

/** A bar is usable only after its end plus the source-specific completion delay. */
export function isBarComplete(endTimeMs: number, completionDelayMs: number, clock: Clock): boolean {
  const end = epochMs(endTimeMs);
  if (!Number.isSafeInteger(completionDelayMs) || completionDelayMs < 0) {
    throw new RangeError(`Expected a non-negative safe completion delay: ${completionDelayMs}`);
  }
  return clock.nowMs() >= end + completionDelayMs;
}
