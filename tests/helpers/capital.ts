import {
  capitalEventIdentity, capitalHash, capitalScopeId,
  type CapitalEventRevision, type CapitalScope, type CapitalSourceBatch, type CapitalTrackingEpoch, type CapitalValuation,
} from '@coqui/core';

export const DAY = 86_400_000;
export const YEAR = 365 * DAY;
export const scope: CapitalScope = {
  id: capitalScopeId('local_paper', 'simulation', capitalHash('account')), provider: 'local_paper',
  environment: 'simulation', accountIdentityHash: capitalHash('account'), currency: 'USD', originProfileId: 'main', createdAtMs: 0,
};
export const batch: CapitalSourceBatch = {
  id: capitalHash('batch'), scopeId: scope.id, source: 'fixture', requestedAtMs: 0, observedAtMs: YEAR * 2, recordedAtMs: YEAR * 2,
  coverage: { fromMs: 0, toMs: YEAR * 2, complete: true, membershipComplete: true, paginationComplete: true, reasonCodes: [] },
  memberIdentityHashes: [scope.accountIdentityHash], evidenceRefs: ['fixture'], payload: { financial: true },
};
export function mark(atMs: number, equityUsd: string, sequence = 0): CapitalValuation {
  return { id: capitalHash({ atMs, equityUsd, sequence }), scopeId: scope.id, sourceBatchId: batch.id,
    replacesId: null, atMs, sequence, observedAtMs: atMs, equityUsd, cashUsd: equityUsd, legs: [], verified: true,
    missingComponents: [], evidenceRefs: ['fixture'] };
}
export function epoch(opening: CapitalValuation): CapitalTrackingEpoch {
  return { id: capitalHash({ opening: opening.id }), scopeId: scope.id, openingValuationId: opening.id,
    predecessorId: null, reason: 'verified_origin', historicalLimitations: [] };
}
export function event(overrides: Partial<Omit<CapitalEventRevision, 'id' | 'revisionHash'>> = {}): CapitalEventRevision {
  const value: Omit<CapitalEventRevision, 'id' | 'revisionHash'> = {
    scopeId: scope.id, sourceBatchId: batch.id, logicalKey: 'fixture:flow', replacesId: null, correctionAuthority: null,
    kind: 'contribution', status: 'confirmed', effectiveTime: { precision: 'instant', fromMs: DAY, toMs: DAY },
    observedAtMs: DAY, recordedAtMs: DAY, legs: [], externalFlowUsd: '500', flowVerified: true,
    confirmedUserReceiptUsd: null, feeUsd: '0', incomeUsd: null, beforeValuationId: null, afterValuationId: null,
    evidenceRefs: ['fixture'], reasonCodes: [], ...overrides,
  };
  return { ...value, ...capitalEventIdentity(value) };
}
