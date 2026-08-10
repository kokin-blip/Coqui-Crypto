import { describe, expect, it } from 'vitest';
import { createSemaphore } from '../packages/core/src/index.js';

describe('createSemaphore', () => {
  it('runs tasks and returns results', async () => {
    await expect(createSemaphore(2).run(async () => 42)).resolves.toBe(42);
  });

  it('serializes FIFO tasks at concurrency one', async () => {
    const semaphore = createSemaphore(1);
    const order: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = semaphore.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
          order.push(1);
        }),
    );
    const second = semaphore.run(async () => {
      order.push(2);
    });
    await Promise.resolve();
    expect(semaphore.active()).toBe(1);
    expect(semaphore.pending()).toBe(1);
    expect(releaseFirst).toBeTypeOf('function');
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });

  it('allows the configured number of tasks to overlap', async () => {
    const semaphore = createSemaphore(2);
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
    };
    const runs = [semaphore.run(task), semaphore.run(task), semaphore.run(task)];
    await Promise.resolve();
    expect(maximum).toBe(2);
    expect(semaphore.pending()).toBe(1);
    release?.();
    await Promise.all(runs);
    expect(maximum).toBe(2);
  });

  it('rejects invalid concurrency', () => {
    expect(() => createSemaphore(0)).toThrow(RangeError);
    expect(() => createSemaphore(1.5)).toThrow(RangeError);
  });
});
