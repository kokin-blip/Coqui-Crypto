import { instrumentKey } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';

import type { MlSignalSnapshot } from './parallel-ml-worker.js';
import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';
import { money, symbolFor } from './parallel-paper-utils.js';

export function readParallelMlSignal(source?: () => MlSignalSnapshot | null): MlSignalSnapshot | null {
  try { return source?.() ?? null; } catch { return null; }
}

export function projectParallelMlStatus(events: readonly ParallelPaperEvent[], snapshot: MlSignalSnapshot | null) {
  const target = [...events].reverse().find((event) => event.kind === 'ml_target' || event.kind === 'ml_shadow_proposal');
  const weights = (key: string) => target === undefined ||
    (key === 'proposedWeights' && (!Array.isArray(target.detail['prediction']) ||
      !target.detail['prediction'].every(Number.isFinite) || typeof target.detail['predictedAtMs'] !== 'number')) ||
    typeof target.detail[key] !== 'object' || target.detail[key] === null ? [] : PARALLEL_INSTRUMENTS.map((instrument) => ({
    symbol: symbolFor(instrumentKey(instrument)),
    weightPct: money(String((target.detail[key] as Record<string, number>)[instrumentKey(instrument)] ?? 0))
      .mul(100).toFixed(1),
  }));
  return {
    gate: snapshot?.gate ?? 'collecting', reason: snapshot?.reason ?? 'hourly_history_incomplete',
    version: snapshot?.version ?? null, modelHash: snapshot?.modelHash ?? null,
    datasetHash: snapshot?.datasetHash ?? null, predictedAtMs: snapshot?.predictedAtMs ?? null,
    evidence: snapshot?.evidence ?? null,
    evidenceStatus: snapshot?.evidence ? 'legacy_historical_unqualified' as const : 'unavailable' as const,
    uncertaintyStatus: !snapshot?.evidence ? 'unavailable' as const :
      snapshot.evidence.lift95LowPct === snapshot.evidence.lift95HighPct ? 'degenerate' as const : 'legacy_recorded' as const,
    provenance: snapshot?.provenance ?? null,
    lastSlot: target === undefined ? null : String(target.detail['slot']),
    lastApplied: target === undefined ? null : target.detail['applied'] === true,
    lastReason: target === undefined ? null : String(target.detail['reason']),
    lastBaseline: weights('baselineWeights'), lastProposed: weights('proposedWeights'),
    lastCombined: weights('combinedWeights'),
  };
}
