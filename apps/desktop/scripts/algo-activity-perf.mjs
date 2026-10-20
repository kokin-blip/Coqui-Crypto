/** Bounded, isolated algorithm-panel workload; see terminal-perf.mjs for all safeguards. */
import { URL,fileURLToPath } from 'node:url';
process.env.COQUI_PERF_ACTIVITY='1';
process.env.COQUI_PERF_SECONDS='15';
process.env.COQUI_PERF_OUTPUT=fileURLToPath(new URL('../../../docs/implementation/evidence/coq33/performance/',import.meta.url));
await import('./terminal-perf.mjs');
