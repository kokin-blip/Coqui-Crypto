export interface Semaphore {
  /** Run a function while respecting the concurrency limit. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Number of currently active slots. */
  active(): number;
  /** Number of calls waiting for a slot. */
  pending(): number;
}

interface QueuedTask {
  start(): void;
}

/** Create a small FIFO semaphore without host or workspace dependencies. */
export function createSemaphore(concurrency: number): Semaphore {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError('Semaphore concurrency must be a positive safe integer');
  }

  let activeCount = 0;
  const queue: QueuedTask[] = [];

  function drain(): void {
    while (activeCount < concurrency) {
      const task = queue.shift();
      if (!task) return;
      activeCount += 1;
      task.start();
    }
  }

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          start() {
            Promise.resolve()
              .then(fn)
              .then(resolve, reject)
              .finally(() => {
                activeCount -= 1;
                drain();
              });
          },
        });
        drain();
      });
    },
    active() {
      return activeCount;
    },
    pending() {
      return queue.length;
    },
  };
}
