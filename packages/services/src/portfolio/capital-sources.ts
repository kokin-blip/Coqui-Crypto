import {
  capitalEventIdentity, capitalHash, capitalScopeId,
  type CapitalEnvironment, type CapitalEventRevision, type CapitalProvider, type CapitalScope, type CapitalSourceBatch,
} from '@coqui/core';

export function capitalSourceScope(profileId: string, provider: CapitalProvider, environment: CapitalEnvironment,
  verifiedIdentityHash: string, atMs: number): CapitalScope {
  return { id: capitalScopeId(provider, environment, verifiedIdentityHash), provider, environment,
    accountIdentityHash: verifiedIdentityHash, currency: 'USD', originProfileId: profileId, createdAtMs: atMs };
}
export function capitalSourceEvent(batch: CapitalSourceBatch, value: Pick<CapitalEventRevision, 'logicalKey' | 'kind' | 'status' | 'legs'> &
  Partial<Omit<CapitalEventRevision, 'id' | 'revisionHash' | 'scopeId' | 'sourceBatchId'>>): CapitalEventRevision {
  const fact: Omit<CapitalEventRevision, 'id' | 'revisionHash'> = {
    scopeId: batch.scopeId, sourceBatchId: batch.id, replacesId: null, correctionAuthority: null,
    effectiveTime: { precision: 'unknown', fromMs: null, toMs: null }, observedAtMs: batch.observedAtMs,
    recordedAtMs: batch.recordedAtMs, externalFlowUsd: null, flowVerified: false, confirmedUserReceiptUsd: null,
    feeUsd: null, incomeUsd: null, beforeValuationId: null, afterValuationId: null,
    evidenceRefs: batch.evidenceRefs, reasonCodes: ['flow_unverified'], ...value,
  };
  return { ...fact, ...capitalEventIdentity(fact) };
}
export function capitalSourceBatch(value: Omit<CapitalSourceBatch, 'id'>): CapitalSourceBatch {
  return { ...value, id: capitalHash(value) };
}
