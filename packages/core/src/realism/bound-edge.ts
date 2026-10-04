import type { ProfitabilityEstimateEvidence } from '../research/forward-edge.js';
export interface ProfitabilityEvidenceBinding {
  readonly profileId: string; readonly strategyId: string; readonly codeRevision: string;
  readonly costProfileHash: string; readonly horizonMs: number;
  readonly normalization: 'gross_pct_per_turnover'; readonly validFromMs: number; readonly validUntilMs: number;
}
export interface BoundProfitabilityEvidence extends ProfitabilityEstimateEvidence { readonly binding: ProfitabilityEvidenceBinding }
export function compatibleProfitabilityLowerBound(evidence: BoundProfitabilityEvidence | null,
  context: Omit<ProfitabilityEvidenceBinding, 'validFromMs' | 'validUntilMs'>, nowMs: number): number | null {
  if (!evidence || !Number.isSafeInteger(nowMs) || !evidence.integrityVerified ||
      !Number.isFinite(evidence.grossEdgeLowerBoundPct) || evidence.grossEdgeLowerBoundPct <= 0 ||
      !/^[a-f0-9]{64}$/u.test(evidence.resultHash) || evidence.sourceHashes.length === 0) return null;
  const b = evidence.binding;
  if (b.profileId !== context.profileId || b.strategyId !== context.strategyId || b.codeRevision !== context.codeRevision ||
      b.costProfileHash !== context.costProfileHash || b.horizonMs !== context.horizonMs ||
      b.normalization !== 'gross_pct_per_turnover' || context.normalization !== b.normalization ||
      !Number.isSafeInteger(b.horizonMs) || b.horizonMs <= 0 ||
      !Number.isSafeInteger(b.validFromMs) || !Number.isSafeInteger(b.validUntilMs) ||
      b.validFromMs < 0 || b.validUntilMs <= b.validFromMs || nowMs < b.validFromMs || nowMs >= b.validUntilMs) return null;
  return evidence.grossEdgeLowerBoundPct;
}
