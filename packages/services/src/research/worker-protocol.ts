import { canonicalJson, evolutionDocumentHash, sha256Hex, type CanonicalJsonValue, type EvolutionMetricsV1 } from '@coqui/core';

export const RESEARCH_WORKER_PROTOCOL_VERSION = 1 as const;
export const RESEARCH_WORKER_PROTOCOL_HASH = sha256Hex('coqui-research-worker-v1:evaluate-candidate-v1');
export const MAX_RESEARCH_ENVELOPE_BYTES = 1_048_576;

export interface ResearchWorkerDefinitionV1 {
  readonly operation: 'evaluate_candidate_v1';
  readonly candidateId: string;
  readonly turnoverPct: number;
  readonly trialCount: number;
}
export interface ResearchWorkerSnapshotV1 {
  readonly oosReturns: readonly number[];
  readonly walkForwardReturns: readonly (readonly number[])[];
  readonly stressReturns: readonly number[];
}
export interface ResearchWorkerEnvelopeV1 {
  readonly format: 'coqui-research-worker-v1'; readonly protocolVersion: 1;
  readonly protocolHash: string; readonly jobId: string;
  readonly definition: ResearchWorkerDefinitionV1; readonly snapshot: ResearchWorkerSnapshotV1;
  readonly snapshotHash: string;
}
export interface ResearchWorkerResultV1 {
  readonly format: 'coqui-research-result-v1'; readonly jobId: string;
  readonly candidateId: string; readonly envelopeHash: string; readonly metrics: EvolutionMetricsV1;
}

function exact(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function finiteSeries(values: readonly number[]): boolean {
  return values.length > 0 && values.length <= 100_000 && values.every(Number.isFinite);
}
export function validateResearchWorkerEnvelope(value: ResearchWorkerEnvelopeV1): void {
  if (!exact(value, ['format','protocolVersion','protocolHash','jobId','definition','snapshot','snapshotHash']) ||
      value.format !== 'coqui-research-worker-v1' || value.protocolVersion !== 1 ||
      value.protocolHash !== RESEARCH_WORKER_PROTOCOL_HASH || value.jobId.length < 1 || value.jobId.length > 200 ||
      !exact(value.definition, ['operation','candidateId','turnoverPct','trialCount']) ||
      value.definition.operation !== 'evaluate_candidate_v1' || value.definition.candidateId.length < 1 ||
      value.definition.candidateId.length > 200 || !Number.isFinite(value.definition.turnoverPct) ||
      !Number.isSafeInteger(value.definition.trialCount) || value.definition.trialCount < 1 ||
      !exact(value.snapshot, ['oosReturns','walkForwardReturns','stressReturns']) ||
      !finiteSeries(value.snapshot.oosReturns) || !finiteSeries(value.snapshot.stressReturns) ||
      value.snapshot.walkForwardReturns.length < 1 || value.snapshot.walkForwardReturns.length > 1_000 ||
      !value.snapshot.walkForwardReturns.every(finiteSeries) ||
      evolutionDocumentHash(value.snapshot as unknown as CanonicalJsonValue) !== value.snapshotHash) {
    throw new TypeError('invalid_research_worker_envelope');
  }
  if (Buffer.byteLength(canonicalJson(value as unknown as CanonicalJsonValue)) > MAX_RESEARCH_ENVELOPE_BYTES) {
    throw new RangeError('research_worker_envelope_too_large');
  }
}

export function researchWorkerEnvelopeJson(value: ResearchWorkerEnvelopeV1): string {
  validateResearchWorkerEnvelope(value);
  return canonicalJson(value as unknown as CanonicalJsonValue);
}

export function createResearchWorkerEnvelope(jobId: string, definition: ResearchWorkerDefinitionV1, snapshot: ResearchWorkerSnapshotV1): ResearchWorkerEnvelopeV1 {
  const value: ResearchWorkerEnvelopeV1 = { format: 'coqui-research-worker-v1', protocolVersion: 1,
    protocolHash: RESEARCH_WORKER_PROTOCOL_HASH, jobId, definition, snapshot,
    snapshotHash: evolutionDocumentHash(snapshot as unknown as CanonicalJsonValue) };
  validateResearchWorkerEnvelope(value);
  return Object.freeze(value);
}

export function validateResearchWorkerResult(result: ResearchWorkerResultV1, envelope: ResearchWorkerEnvelopeV1, envelopeHash: string): void {
  if (!exact(result, ['format','jobId','candidateId','envelopeHash','metrics']) ||
      result.format !== 'coqui-research-result-v1' || result.jobId !== envelope.jobId ||
      result.candidateId !== envelope.definition.candidateId || result.envelopeHash !== envelopeHash ||
      !exact(result.metrics, ['oosReturnPct','walkForwardPassRate','stressReturnPct','maxDrawdownPct',
        'turnoverPct','significanceProbability','stabilityScore','trialCount']) ||
      Object.values(result.metrics).some((item) => !Number.isFinite(item))) {
    throw new TypeError('invalid_research_worker_result');
  }
}
