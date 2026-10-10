import { monitorEventLoopDelay } from 'node:perf_hooks';

const enabled = process.env['COQUI_PERFORMANCE_TRACE'] === '1';
const loop = enabled ? monitorEventLoopDelay({ resolution: 20 }) : null;
loop?.enable();
const events: { stage: string; identity: string; atMs: number; durationMs: number; count: number }[] = [];
/** Diagnostic numeric fields only: no URLs, payloads, account identifiers or credentials. */
export function tracePerformance(stage: string, identity: string, started: number, count = 0): void {
  if (!enabled) return;
  if (!/^[a-z][a-z0-9_.:-]{0,80}$/iu.test(stage) || !/^[a-z0-9_.:-]{1,128}$/iu.test(identity)) return;
  if (![started,count].every(Number.isFinite) || count < 0) return;
  if (events.length >= 2000) events.shift();
  events.push({ stage, identity, atMs: Date.now(), durationMs: Math.max(0,performance.now()-started), count });
}
export function readPerformanceTrace() {
  const memory = process.memoryUsage(), cpu = process.cpuUsage();
  return { enabled, observedAtMs: Date.now(), events: [...events],
    heapBytes: memory.heapUsed, cpuUserUs: cpu.user, cpuSystemUs: cpu.system,
    eventLoopP95Ms: loop && Number.isFinite(loop.percentile(95)) ? loop.percentile(95)/1e6 : null,
    eventLoopMaxMs: loop && Number.isFinite(loop.max) ? loop.max/1e6 : null };
}
