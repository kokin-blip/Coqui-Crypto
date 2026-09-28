import { parentPort, workerData } from 'node:worker_threads';

import { evaluateParallelMlSignal } from '@coqui/services';
import type { MlHourlyBar } from '@coqui/storage';

const input = workerData as { readonly bars: readonly MlHourlyBar[]; readonly nowMs: number;
  readonly studyEndMs: number; readonly functionalChecksPassed: boolean };
try {
  parentPort?.postMessage({ ok: true, snapshot: evaluateParallelMlSignal(input) });
} catch (error) {
  parentPort?.postMessage({ ok: false, reason: error instanceof Error ? error.message : 'ml_worker_failed' });
}
