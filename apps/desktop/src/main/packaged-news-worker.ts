import { Worker } from 'node:worker_threads';

/** Verify the shipped worker and its pure dependencies without network or live data. */
export async function verifyPackagedNewsWorker(): Promise<void> {
  const worker = new Worker(new URL('./news/analysis-worker.js', import.meta.resolve('@coqui/services')), {
    workerData: { analyses: [], registry: [], cutoff: 0, runId: '0'.repeat(64), baselines: [], coverage: {} },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Packaged worker timeout.')); }, 5000);
      const finish = (error?: Error) => { clearTimeout(timer); if (error) reject(error); else resolve(); };
      worker.once('message', (value: unknown) => {
        const result = value as { clusters?: unknown[]; features?: unknown[] };
        finish(Array.isArray(result?.clusters) && result.clusters.length === 0 && Array.isArray(result.features) && result.features.length === 0 ? undefined : new Error('Invalid packaged worker result.'));
      });
      worker.once('error', error => finish(error instanceof Error ? error : new Error('Packaged worker failed.')));
      worker.once('exit', () => finish(new Error('Packaged worker stopped.')));
    });
  } finally { await worker.terminate(); }
}
