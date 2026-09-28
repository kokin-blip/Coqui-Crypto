import { Worker } from 'node:worker_threads';

import { canonicalJson, ML_SIGNAL_VERSION, sha256Hex } from '@coqui/core';
import { PARALLEL_INSTRUMENTS, verifyParallelMlExecutionPath, type MlSignalSnapshot } from '@coqui/services';
import { finishMlSignalStudy, getMlSignalStudy, listMlHourlyBars, registerMlSignalStudy,
  saveMlHourlyBars, type Db, type MlHourlyBar } from '@coqui/storage';

import type { createHistoricalCoinbaseCandleSource } from './coinbase-candle-source.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PAGE_HOURS = 300;
const HISTORY_DAYS = 400;

async function evaluateInWorker(bars: readonly MlHourlyBar[], nowMs: number,
  studyEndMs: number, functionalChecksPassed: boolean): Promise<MlSignalSnapshot> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ml-signal-worker-thread.js', import.meta.url), {
      workerData: { bars, nowMs, studyEndMs, functionalChecksPassed },
    });
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('ml_worker_timeout')); }, 30_000);
    worker.once('message', (result: { ok: boolean; snapshot?: MlSignalSnapshot; reason?: string }) => {
      clearTimeout(timeout); void worker.terminate();
      if (result.ok && result.snapshot !== undefined && result.snapshot.version === ML_SIGNAL_VERSION) resolve(result.snapshot);
      else reject(new Error(result.reason ?? 'ml_worker_failed'));
    });
    worker.once('error', (error) => { clearTimeout(timeout); reject(error); });
    worker.once('exit', (code) => { if (code !== 0) { clearTimeout(timeout); reject(new Error('ml_worker_exit')); } });
  });
}

/** Main-process I/O boundary. The worker only receives immutable price bars. */
export function createMlSignalRuntime(input: { readonly profileId: string; readonly database: Db;
  readonly candleSource: ReturnType<typeof createHistoricalCoinbaseCandleSource>;
  readonly onUnexpectedError: (context: string, error: unknown) => void }) {
  let startMs: number | null = null;
  let windowIndex = 0;
  let lastSlot: string | null = null;
  const savedStudy = getMlSignalStudy(input.profileId, ML_SIGNAL_VERSION, input.database);
  const savedResult = savedStudy?.result;
  let snapshot: MlSignalSnapshot | null = savedStudy === null ? null : {
    version: ML_SIGNAL_VERSION, datasetHash: savedStudy.datasetHash,
    modelHash: typeof savedResult?.['modelHash'] === 'string' ? savedResult['modelHash'] : null,
    gate: savedResult?.['gate'] === 'qualified' ? 'qualified' :
      savedResult?.['gate'] === 'unqualified' ? 'unqualified' : 'collecting',
    reason: 'awaiting_signal_refresh', predictedAtMs: null, prediction: null,
    proposedWeights: null, baselineWeights: null, expectedNetImprovement: null,
    evidence: savedResult?.['evidence'] as MlSignalSnapshot['evidence'] ?? null,
  };
  let busy = false;
  let functionalChecks: Promise<boolean> | null = null;
  const windowCount = Math.ceil(HISTORY_DAYS * 24 / PAGE_HOURS);
  const fetchWindow = async (fromMs: number, toMs: number, nowMs: number) => {
    const all: MlHourlyBar[] = [];
    for (const instrument of PARALLEL_INSTRUMENTS) {
      const result = await input.candleSource.researchHourlyWindow(instrument, fromMs, toMs, nowMs);
      if (!result.ok) return false;
      all.push(...result.bars.map((bar) => ({ productId: instrument.productId as MlHourlyBar['productId'],
        startTimeMs: bar.startTimeMs, open: bar.open, high: bar.high, low: bar.low,
        close: bar.close, volume: bar.volume, source: result.source, retrievedAtMs: bar.retrievedAtMs })));
    }
    saveMlHourlyBars(input.profileId, all, input.database);
    return true;
  };
  return {
    current: () => snapshot,
    async refresh(nowMs: number): Promise<void> {
      if (busy) return;
      busy = true;
      try {
        const completeHour = Math.floor(nowMs / HOUR) * HOUR;
        if (startMs === null) startMs = completeHour - HISTORY_DAYS * DAY;
        while (windowIndex < windowCount) {
          const from = startMs + windowIndex * PAGE_HOURS * HOUR;
          const to = Math.min(completeHour, from + PAGE_HOURS * HOUR);
          const stored = listMlHourlyBars(input.profileId, from, to, input.database);
          if (stored.length >= Math.ceil((to - from) / HOUR) * 3 * 0.95) {
            windowIndex += 1;
            continue;
          }
          if (!await fetchWindow(from, to, nowMs)) return;
          windowIndex += 1;
          if (windowIndex < windowCount) return; // one network window per scheduler tick
        }
        const date = new Date(nowMs);
        const hour = date.getUTCHours();
        const slot = `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}`;
        if (lastSlot === slot) return;
        if (hour === 0 || hour % 4 !== 0 || date.getUTCMinutes() >= 15) return;
        if (!await fetchWindow(completeHour - 48 * HOUR, completeHour, nowMs)) return;
        const registered = getMlSignalStudy(input.profileId, ML_SIGNAL_VERSION, input.database);
        const historyStart = registered === null ? startMs : Math.min(startMs, registered.studyEndMs - HISTORY_DAYS * DAY);
        const bars = listMlHourlyBars(input.profileId, historyStart, completeHour, input.database);
        const plan = { version: ML_SIGNAL_VERSION, candidateCount: 1, assets: ['BTC-USD', 'ETH-USD', 'LTC-USD'],
          features: ['return4h', 'return24h', 'return7d', 'vol24h', 'relative24h'],
          model: 'ridge-l2-10', trainDays: 120, developmentDays: 60, holdoutDays: 90,
          minimumCoverage: 0.95, sideCost: 0.005, maximumDelta: 0.10 };
        let study = registered;
        if (study === null) {
          registerMlSignalStudy({ profileId: input.profileId, candidateVersion: ML_SIGNAL_VERSION,
            registeredAtMs: nowMs, studyEndMs: Math.floor(nowMs / DAY) * DAY,
            datasetHash: sha256Hex(canonicalJson(bars.filter((bar) =>
              bar.startTimeMs < Math.floor(nowMs / DAY) * DAY).map((bar) =>
              [bar.productId, bar.startTimeMs, bar.open, bar.close, bar.source]) as never)),
            planHash: sha256Hex(canonicalJson(plan as never)), plan }, input.database);
          study = getMlSignalStudy(input.profileId, ML_SIGNAL_VERSION, input.database);
        }
        if (study === null) throw new Error('ml_study_registration_failed');
        functionalChecks ??= verifyParallelMlExecutionPath();
        const evaluated = await evaluateInWorker(bars, nowMs, study.studyEndMs, await functionalChecks);
        if (study.result === null && evaluated.gate !== 'collecting') {
          finishMlSignalStudy(input.profileId, ML_SIGNAL_VERSION,
            { gate: evaluated.gate, reason: evaluated.reason, evidence: evaluated.evidence,
              datasetHash: evaluated.datasetHash, modelHash: evaluated.modelHash }, input.database);
          study = getMlSignalStudy(input.profileId, ML_SIGNAL_VERSION, input.database)!;
        }
        const recorded = study.result;
        snapshot = recorded === null ? evaluated : { ...evaluated,
          gate: recorded['gate'] === 'qualified' && recorded['datasetHash'] === evaluated.datasetHash
            ? 'qualified' : 'unqualified',
          reason: recorded['datasetHash'] === evaluated.datasetHash ? String(recorded['reason']) : 'study_dataset_changed',
          evidence: recorded['evidence'] as MlSignalSnapshot['evidence'] };
        if (snapshot.gate === 'collecting') windowIndex = 0;
        lastSlot = slot;
      } catch (error) { input.onUnexpectedError('ml_signal_refresh', error); }
      finally { busy = false; }
    },
  };
}
