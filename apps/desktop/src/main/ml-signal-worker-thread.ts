import { parentPort, workerData } from 'node:worker_threads';

import { inferParallelMlSignal } from '@coqui/services';
import type { MlHourlyBar } from '@coqui/storage';

export interface MlSignalWorkerInput { readonly bars: readonly MlHourlyBar[]; readonly nowMs: number;
  readonly baseline: readonly number[]; readonly behaviorHash: string;
  readonly protectedPeriods: readonly { startMs: number; endMs: number }[] }
const input = workerData as MlSignalWorkerInput;
try {
  parentPort?.postMessage({ ok: true, snapshot: inferParallelMlSignal(input) });
} catch (error) {
  parentPort?.postMessage({ ok: false, reason: error instanceof Error ? error.message : 'ml_worker_failed' });
}
