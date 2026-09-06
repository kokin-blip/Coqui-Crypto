import { canonicalJson, evaluatePromotionEligibility, evolutionDocumentHash, sha256Hex,
  type CanonicalJsonValue, type EvolutionMetricsV1, type EvolutionPolicyV1 } from '@coqui/core';
import { activateResearchCandidate, getResearchCandidate, getResearchChampion, saveResearchCandidate,
  type Db, type ResearchCandidateRecord, type ResearchChampionRecord } from '@coqui/storage';

export class EvolutionCoordinator {
  constructor(private readonly database: Db) {}

  evaluate(input: { readonly family: string; readonly strategyVersion: string;
    readonly parentId?: string; readonly evidenceId: string; readonly evidenceHash: string;
    readonly metrics: EvolutionMetricsV1; readonly policy: EvolutionPolicyV1; readonly createdAt: number }): ResearchCandidateRecord {
    const parent = input.parentId === undefined ? null : getResearchCandidate(input.parentId, this.database);
    if (input.parentId !== undefined && (parent === null || parent.family !== input.family)) {
      throw new Error('Candidate parent is missing or belongs to another family.');
    }
    if (!/^[a-f0-9]{64}$/u.test(input.evidenceHash)) throw new TypeError('Invalid candidate evidence hash.');
    const assessment = evaluatePromotionEligibility(input.metrics, input.policy);
    const metricsJson = canonicalJson(input.metrics as unknown as CanonicalJsonValue);
    const metricsHash = sha256Hex(metricsJson);
    const material = { family: input.family, strategyVersion: input.strategyVersion,
      parentId: input.parentId ?? null, evidenceId: input.evidenceId, evidenceHash: input.evidenceHash,
      metricsHash, state: assessment.eligible ? 'promotion_eligible' : 'rejected', blockers: assessment.blockers };
    const candidate: ResearchCandidateRecord = { id: evolutionDocumentHash(material as unknown as CanonicalJsonValue),
      family: input.family, strategyVersion: input.strategyVersion, parentId: input.parentId ?? null,
      evidenceId: input.evidenceId, evidenceHash: input.evidenceHash, metricsJson, metricsHash,
      state: assessment.eligible ? 'promotion_eligible' : 'rejected',
      reasonCodesJson: canonicalJson(assessment.blockers as unknown as CanonicalJsonValue), createdAt: input.createdAt };
    saveResearchCandidate(candidate, this.database);
    return Object.freeze(candidate);
  }

  champion(family: string): ResearchChampionRecord | null { return getResearchChampion(family, this.database); }
  approve(candidateId: string, humanApprovalRef: string, at: number): ResearchChampionRecord {
    return activateResearchCandidate(candidateId, humanApprovalRef, 'activate', at, this.database);
  }
  rollback(candidateId: string, humanApprovalRef: string, at: number): ResearchChampionRecord {
    return activateResearchCandidate(candidateId, humanApprovalRef, 'rollback', at, this.database);
  }
}
