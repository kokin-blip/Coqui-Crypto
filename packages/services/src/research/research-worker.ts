import { parentPort, workerData } from 'node:worker_threads';
import { canonicalJson, sha256Hex, type CanonicalJsonValue } from '@coqui/core';
import { validateResearchWorkerEnvelope, type ResearchWorkerEnvelopeV1 } from './worker-protocol.js';

function compounded(values: readonly number[]): number {
  return (values.reduce((total, value) => total * (1 + value / 100), 1) - 1) * 100;
}
function drawdown(values: readonly number[]): number {
  let equity = 1, peak = 1, maximum = 0;
  for (const value of values) { equity *= 1 + value / 100; peak = Math.max(peak, equity); maximum = Math.max(maximum, (peak - equity) / peak * 100); }
  return maximum;
}
function significance(values: readonly number[]): number {
  const positive = values.filter((value) => value > 0).length;
  return positive / values.length;
}

try {
  const envelope = workerData as ResearchWorkerEnvelopeV1;
  validateResearchWorkerEnvelope(envelope);
  const envelopeHash = sha256Hex(canonicalJson(envelope as unknown as CanonicalJsonValue));
  const folds = envelope.snapshot.walkForwardReturns.map(compounded);
  const metrics = {
    oosReturnPct: compounded(envelope.snapshot.oosReturns),
    walkForwardPassRate: folds.filter((value) => value > 0).length / folds.length,
    stressReturnPct: compounded(envelope.snapshot.stressReturns),
    maxDrawdownPct: drawdown(envelope.snapshot.oosReturns),
    turnoverPct: envelope.definition.turnoverPct,
    significanceProbability: significance(envelope.snapshot.oosReturns),
    stabilityScore: folds.filter((value) => value > 0).length / folds.length,
    trialCount: envelope.definition.trialCount,
  };
  parentPort?.postMessage({ format: 'coqui-research-result-v1', jobId: envelope.jobId,
    candidateId: envelope.definition.candidateId, envelopeHash, metrics });
} catch {
  parentPort?.postMessage({ format: 'coqui-research-error-v1', code: 'invalid_envelope' });
}
