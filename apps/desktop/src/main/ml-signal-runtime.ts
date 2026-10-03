import { Worker } from 'node:worker_threads';
import { createResearchDeadline, withinDeadline } from '@coqui/adapters';
import { canonicalJson, instrumentKey, ML_SIGNAL_VERSION, sha256Hex, STUDY_BEHAVIOR_HASHES } from '@coqui/core';
import { completeMlWindow, ML_INFERENCE_PLAN, ML_INFERENCE_VERSION, PARALLEL_INSTRUMENTS,
  type MlSignalSnapshot } from '@coqui/services';
import { appendParallelEvent, appendRemediationEvidence, getMlSignalStudy, latestParallelExperiment,
  listMlHourlyBars, listParallelEvents, listRemediationEvidence, parallelExperimentStatus,
  saveMlHourlyBars, type Db, type MlHourlyBar } from '@coqui/storage';
import type { MlSignalWorkerInput } from './ml-signal-worker-thread.js';
import type { createHistoricalCoinbaseCandleSource } from './coinbase-candle-source.js';

const HOUR = 3_600_000, DAY = 24 * HOUR, PAGE_HOURS = 300;
type WorkerInput = MlSignalWorkerInput;
export async function evaluateInWorker(input: WorkerInput, signal?: AbortSignal): Promise<MlSignalSnapshot> {
  if (signal?.aborted) throw new Error('research_budget_exhausted');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ml-signal-worker-thread.js', import.meta.url), { workerData: input });
    let settled = false;
    const finish = (result?: MlSignalSnapshot, reason = 'ml_worker_failed') => {
      if (settled) return; settled = true; clearTimeout(timeout); signal?.removeEventListener('abort', abort); void worker.terminate();
      if (result) resolve(result); else reject(new Error(reason));
    };
    const abort = () => finish(undefined, 'research_budget_exhausted');
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => finish(undefined, 'ml_worker_timeout'), 30_000);
    worker.once('message', (result: { ok: boolean; snapshot?: MlSignalSnapshot }) =>
      finish(result.ok ? result.snapshot : undefined));
    worker.once('error', () => finish());
    worker.once('exit', () => finish(undefined, 'ml_worker_exit'));
  });
}

/** Collection and inference are independent of broker execution and never evaluate a holdout. */
export function createMlSignalRuntime(input: { readonly profileId: string; readonly database: Db;
  readonly candleSource: ReturnType<typeof createHistoricalCoinbaseCandleSource>; readonly nowMs?: () => number;
  readonly worker?: typeof evaluateInWorker;
  readonly onUnexpectedError: (context: string, error: unknown) => void }) {
  const study = getMlSignalStudy(input.profileId, ML_SIGNAL_VERSION, input.database);
  const legacyEvidence = study?.result?.['evidence'] as MlSignalSnapshot['evidence'] ?? null;
  let snapshot: MlSignalSnapshot | null = null, busy = false, lastSlot: number | null = null;
  let sequence = listRemediationEvidence(input.profileId, ML_INFERENCE_VERSION, 'status', input.database).length;
  const now = input.nowMs ?? Date.now;
  const unavailable = (reason: string, atMs: number, operation = 'shadow_refresh') => {
    snapshot = { version: ML_INFERENCE_VERSION, datasetHash: study?.datasetHash ?? sha256Hex('unavailable'),
      modelHash: null, gate: 'collecting', reason, predictedAtMs: null, prediction: null,
      proposedWeights: null, baselineWeights: null, expectedNetImprovement: null, evidence: legacyEvidence };
    appendRemediationEvidence({ profileId: input.profileId, namespace: ML_INFERENCE_VERSION, kind: 'status',
      key: `${atMs}:${sequence++}`, atMs, body: { reason, operation, mode: 'shadow', legacyStudyPresent: study !== null } }, input.database);
  };
  unavailable('awaiting_signal_refresh', now());
  return {
    current: () => snapshot,
    async refresh(_requestedAtMs: number): Promise<void> {
      void _requestedAtMs;
      if (busy) return;
      const experiment = latestParallelExperiment(input.profileId, input.database);
      if (!experiment || parallelExperimentStatus(listParallelEvents(experiment.id, input.profileId, input.database)) === 'stopped') return;
      busy = true;
      const deadline = createResearchDeadline(now);
      let operation = 'recent_collection', requestedSlotMs: number | null = null;
      try {
        const captured = now(), completeHour = Math.floor(captured / HOUR) * HOUR;
        const fetchWindow = async (fromMs: number, toMs: number): Promise<boolean> => {
          for (const instrument of PARALLEL_INSTRUMENTS) {
            deadline.check();
            const cached = listMlHourlyBars(input.profileId, fromMs, toMs, input.database);
            if (completeMlWindow(cached, fromMs, toMs)) return true;
            const productId = instrument.productId as MlHourlyBar['productId'];
            if (completeMlWindow(cached, fromMs, toMs, [productId])) continue;
            const result = await withinDeadline(input.candleSource.researchHourlyWindow(instrument, fromMs, toMs, now(), deadline), deadline);
            if (!result.ok) return false;
            const assetBars = result.bars.filter((bar) => bar.startTimeMs >= fromMs && bar.startTimeMs < toMs).map((bar) => ({ productId,
              startTimeMs: bar.startTimeMs, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
              volume: bar.volume, source: result.source, retrievedAtMs: bar.retrievedAtMs }));
            if (!completeMlWindow(assetBars, fromMs, toMs, [productId])) return false;
            deadline.check(); saveMlHourlyBars(input.profileId, assetBars, input.database);
          }
          return completeMlWindow(listMlHourlyBars(input.profileId, fromMs, toMs, input.database), fromMs, toMs);
        };
        // Current features get acquisition priority over background training-history gaps.
        if (!await fetchWindow(completeHour - 48 * HOUR, completeHour)) {
          unavailable('recent_hour_collection_incomplete', now()); return;
        }
        operation = 'training_collection';
        const day = Math.floor(captured / DAY) * DAY;
        const week = day - ((new Date(captured).getUTCDay() + 6) % 7) * DAY;
        const historyStart = week - 120 * DAY - 169 * HOUR;
        for (let from = historyStart; from < completeHour; from += PAGE_HOURS * HOUR) {
          const to = Math.min(from + PAGE_HOURS * HOUR, completeHour);
          if (completeMlWindow(listMlHourlyBars(input.profileId, from, to, input.database), from, to)) continue;
          if (!await fetchWindow(from, to)) { unavailable('training_hour_collection_incomplete', now()); return; }
          unavailable('training_history_backfill', now()); return;
        }
        const currentMs = now(), slotMs = Math.floor(currentMs / (4 * HOUR)) * 4 * HOUR;
        if (new Date(slotMs).getUTCHours() === 0 || currentMs >= slotMs + 900_000) {
          unavailable('outside_shadow_window', currentMs); return;
        }
        if (lastSlot === slotMs) return;
        const decision = [...listParallelEvents(experiment.id, input.profileId, input.database)].reverse()
          .find((event) => event.kind === 'decision' && event.detail['day'] === new Date(currentMs - DAY).toISOString().slice(0, 10));
        if (!decision) { unavailable('completed_daily_baseline_unavailable', currentMs); return; }
        const behaviorHash = STUDY_BEHAVIOR_HASHES[ML_INFERENCE_VERSION];
        if (!behaviorHash) { unavailable('inference_behavior_manifest_unavailable', currentMs); return; }
        const baselineWeights = decision.detail['weights'] as Record<string, number>;
        const baseline = PARALLEL_INSTRUMENTS.map((instrument) => baselineWeights[instrumentKey(instrument)] ?? 0);
        const bars = listMlHourlyBars(input.profileId, historyStart, Math.floor(currentMs / HOUR) * HOUR, input.database);
        const inputHash = sha256Hex(canonicalJson(bars as never));
        const prior = listParallelEvents(experiment.id, input.profileId, input.database).find((event) =>
          event.kind === 'ml_shadow_proposal' && event.detail['predictedAtMs'] === slotMs &&
          event.detail['modelVersion'] === ML_INFERENCE_VERSION && event.detail['baselineDecisionId'] === decision.id &&
          (event.detail['provenance'] as MlSignalSnapshot['provenance'])?.behaviorHash === behaviorHash);
        if (prior) {
          if (prior.detail['datasetHash'] !== inputHash) { unavailable('recorded_shadow_inputs_changed', currentMs); return; }
          const detail = prior.detail;
          snapshot = { version: ML_INFERENCE_VERSION, datasetHash: String(detail['datasetHash']),
            modelHash: String(detail['modelHash']), gate: 'unqualified', reason: String(detail['reason']),
            predictedAtMs: slotMs, prediction: detail['prediction'] as number[], baselineWeights: baseline,
            proposedWeights: PARALLEL_INSTRUMENTS.map((instrument) =>
              Number((detail['proposedWeights'] as Record<string, number>)[instrumentKey(instrument)])),
            expectedNetImprovement: Number(detail['expectedNetImprovement']), evidence: legacyEvidence,
            provenance: detail['provenance'] as NonNullable<MlSignalSnapshot['provenance']> };
          lastSlot = slotMs; return;
        }
        const protectedPeriods = listRemediationEvidence(input.profileId, 'study-instances-v1', 'study', input.database)
          .map((record) => record.body as unknown as { definition: { foldEndsMs: number[]; holdoutEndMs: number } })
          .map(({ definition }) => ({ startMs: definition.foldEndsMs.at(-1)!, endMs: definition.holdoutEndMs }));
        if (study && study.result === null) protectedPeriods.push({ startMs: study.studyEndMs - 90 * DAY, endMs: study.studyEndMs });
        operation = 'inference'; requestedSlotMs = slotMs;
        const evaluated = await withinDeadline((input.worker ?? evaluateInWorker)({ bars, nowMs: currentMs,
          baseline, behaviorHash, protectedPeriods }, deadline.signal), deadline);
        const finished = now();
        if (finished >= slotMs + 900_000 || Math.floor(finished / (4 * HOUR)) * 4 * HOUR !== slotMs) {
          unavailable('shadow_worker_completed_late', finished); return;
        }
        if (evaluated.version !== ML_INFERENCE_VERSION || evaluated.datasetHash !== inputHash ||
            evaluated.provenance?.behaviorHash !== behaviorHash || evaluated.provenance.planHash !== sha256Hex(canonicalJson(ML_INFERENCE_PLAN as never)) ||
            evaluated.provenance.slotMs !== slotMs || evaluated.provenance.trainingCutoffMs !== week) {
          unavailable('shadow_worker_provenance_mismatch', finished); return;
        }
        snapshot = { ...evaluated, evidence: legacyEvidence };
        if (evaluated.predictedAtMs !== slotMs || !evaluated.prediction || !evaluated.proposedWeights ||
            evaluated.prediction.length !== 3 || !evaluated.prediction.every(Number.isFinite)) {
          unavailable(evaluated.reason, finished); return;
        }
        const slot = new Date(slotMs).toISOString().slice(0, 13);
        const proposedWeights = Object.fromEntries(PARALLEL_INSTRUMENTS.map((instrument, index) =>
          [instrumentKey(instrument), evaluated.proposedWeights![index]!]));
        appendParallelEvent({ experimentId: experiment.id, profileId: input.profileId, kind: 'ml_shadow_proposal',
          key: `ml-shadow:${ML_INFERENCE_VERSION}:${slotMs}:${behaviorHash}`, at: finished,
          detail: { slot, modelVersion: evaluated.version, modelHash: evaluated.modelHash, datasetHash: evaluated.datasetHash,
            provenance: evaluated.provenance!, baselineDecisionId: decision.id, predictedAtMs: slotMs, prediction: evaluated.prediction,
            baselineWeights, proposedWeights, combinedWeights: baselineWeights, applied: false, gate: 'unqualified',
            reason: evaluated.reason, expectedNetImprovement: evaluated.expectedNetImprovement } }, input.database);
        lastSlot = slotMs;
      } catch (error) {
        const late = requestedSlotMs !== null && now() >= requestedSlotMs + 900_000;
        unavailable(late ? 'shadow_worker_completed_late' : deadline.signal.aborted || deadline.remainingMs() <= 0 ?
          'research_budget_exhausted' : 'shadow_refresh_failed', now(), operation);
        input.onUnexpectedError('ml_signal_refresh', new Error(snapshot?.reason ?? 'shadow_refresh_failed'));
        void error;
      } finally { deadline.dispose(); busy = false; }
    },
  };
}
