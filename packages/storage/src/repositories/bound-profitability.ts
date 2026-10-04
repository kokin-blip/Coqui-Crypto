import { compatibleProfitabilityLowerBound, type BoundProfitabilityEvidence,
  type ProfitabilityEvidenceBinding, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';
import { readProfitabilityEstimateEvidence } from './forward-edge.js';
import { appendIntegrityEvent, listIntegrityEvents } from './research-integrity.js';
/** Explicit qualification operation; legacy activations cannot acquire a binding automatically. */
export function bindActivatedProfitabilityEvidence(binding: ProfitabilityEvidenceBinding, atMs: number, db: Db): void {
  const evidence = readProfitabilityEstimateEvidence(binding.profileId, db);
  if (compatibleProfitabilityLowerBound(evidence ? { ...evidence, binding } : null, binding, atMs) === null) {
    throw new Error('Applicable activated evidence required');
  }
  const result = db.prepare('SELECT result_json FROM forward_edge_study_results_v1 WHERE result_hash=?')
    .get(evidence!.resultHash) as { result_json: string };
  const planHash = (JSON.parse(result.result_json) as { planHash: string }).planHash;
  const planRow = db.prepare('SELECT plan_json FROM forward_edge_study_plans_v1 WHERE plan_hash=?')
    .get(planHash) as { plan_json: string } | undefined;
  if (!planRow) throw new Error('Source plan unavailable');
  const plan = JSON.parse(planRow.plan_json) as { strategyId: string; codeRevision: string; costProfileHash: string };
  if (plan.strategyId !== binding.strategyId || plan.codeRevision !== binding.codeRevision ||
      plan.costProfileHash !== binding.costProfileHash || binding.horizonMs !== 86_400_000) throw new Error('Evidence source semantics mismatch');
  const hashes = db.prepare('SELECT evidence_hash FROM forward_edge_observations_v1 WHERE plan_hash=? AND profile_id=?')
    .all(planHash, binding.profileId) as { evidence_hash: string }[];
  if (!evidence!.sourceHashes.every((hash) => hashes.some((row) => row.evidence_hash === hash))) throw new Error('Evidence profile mismatch');
  appendIntegrityEvent({ namespace: `profitability:${binding.profileId}`, kind: 'binding', key: evidence!.resultHash,
    atMs, body: { binding, resultHash: evidence!.resultHash } as unknown as CanonicalJsonValue }, db);
}
export function readBoundProfitabilityEvidence(profileId: string, db: Db,
  context: Omit<ProfitabilityEvidenceBinding, 'validFromMs' | 'validUntilMs'>, nowMs: number): BoundProfitabilityEvidence | null {
  if (context.profileId !== profileId) return null;
  const evidence = readProfitabilityEstimateEvidence(profileId, db);
  if (!evidence) return null;
  const event = listIntegrityEvents(`profitability:${profileId}`, 'binding', db).find((row) => row.key === evidence.resultHash);
  if (!event) return null;
  const body = event.body as unknown as { binding: ProfitabilityEvidenceBinding; resultHash: string };
  if (body.resultHash !== evidence.resultHash) return null;
  const bound = { ...evidence, binding: body.binding };
  return compatibleProfitabilityLowerBound(bound, context, nowMs) === null ? null : bound;
}
