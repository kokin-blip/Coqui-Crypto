import {
  calculateCapitalPerformance, capitalEventHeads, capitalEventIdentity, capitalHash,
  type CapitalEventRevision, type CapitalPerformanceReport, type CapitalScope, type CapitalSourceBatch,
  type CapitalTrackingEpoch, type CapitalValuation,
} from '@coqui/core';
import {
  getCapitalScope, inTransaction, listCapitalBindings, listCapitalEpochs, listCapitalEvents,
  listCapitalSourceBatches, listCapitalValuations, saveCapitalBinding, saveCapitalEpoch, saveCapitalEvent,
  saveCapitalReport, saveCapitalScope, saveCapitalSourceBatch, saveCapitalValuation, rebindCapitalScopeAfterVerification, setSetting, type Db,
} from '@coqui/storage';

export interface CapitalIngestion {
  readonly profileId: string; readonly connectionId: string | null;
  readonly scope: CapitalScope; readonly batch: CapitalSourceBatch;
  readonly events: readonly CapitalEventRevision[]; readonly valuations: readonly CapitalValuation[];
  readonly opening: { readonly valuationId: string; readonly historicalLimitations: readonly string[];
    readonly reason: CapitalTrackingEpoch['reason'] } | null;
}

/** Only evidence persistence is reachable here. This service has no broker/credential/order ports. */
export function ingestCapitalEvidence(input: CapitalIngestion, database: Db): CapitalPerformanceReport {
  return inTransaction(database, () => {
    const binding = listCapitalBindings(input.profileId, database).find((row) => row.scopeId === input.scope.id);
    if (binding?.mode === 'archived' && !rebindCapitalScopeAfterVerification(input.profileId, input.scope.id, input.connectionId, database)) {
      throw new Error('capital_archived_binding');
    }
    if (input.batch.scopeId !== input.scope.id || input.events.some((row) => row.scopeId !== input.scope.id || row.sourceBatchId !== input.batch.id) ||
      input.valuations.some((row) => row.scopeId !== input.scope.id || row.sourceBatchId !== input.batch.id)) throw new TypeError('Capital ingestion scope mismatch.');
    const scope = saveCapitalScope(input.scope, database);
    saveCapitalSourceBatch(input.batch, database);
    for (const valuation of input.valuations) saveCapitalValuation(valuation, database);
    const existing = listCapitalEvents(scope.id, database);
    const existingIds = new Set(existing.map((row) => row.id));
    const headsByKey = new Map<string, CapitalEventRevision[]>();
    for (const head of capitalEventHeads(existing).events) {
      const group = headsByKey.get(head.logicalKey) ?? []; group.push(head); headsByKey.set(head.logicalKey, group);
    }
    for (const proposed of input.events) {
      let event = proposed;
      if (event.replacesId === null && !existingIds.has(event.id)) {
        const heads = headsByKey.get(event.logicalKey) ?? [];
        const prior = heads.length === 1 ? heads[0] : undefined;
        if (prior?.status === 'pending' && event.status !== 'pending' && prior.kind === event.kind && capitalHash(prior.legs) === capitalHash(event.legs)) {
          event = { ...event, replacesId: prior.id, correctionAuthority: 'status_transition' };
        }
      }
      const identity = capitalEventIdentity(event);
      saveCapitalEvent({ ...event, ...identity }, database);
      if (!existingIds.has(event.id)) {
        existingIds.add(event.id);
        headsByKey.set(event.logicalKey, [...(headsByKey.get(event.logicalKey) ?? []).filter((row) => row.id !== event.replacesId), event]);
      }
    }
    let epochs = listCapitalEpochs(scope.id, database);
    if (epochs.length === 0 && input.opening !== null) {
      const epoch: CapitalTrackingEpoch = { id: capitalHash({ scopeId: scope.id, openingValuationId: input.opening.valuationId }),
        scopeId: scope.id, openingValuationId: input.opening.valuationId, predecessorId: null,
        reason: input.opening.reason, historicalLimitations: input.opening.historicalLimitations };
      saveCapitalEpoch(epoch, database); epochs = [epoch];
    }
    const report = calculateCapitalPerformance({ scope, epoch: epochs[0] ?? null,
      batches: listCapitalSourceBatches(scope.id, database), events: listCapitalEvents(scope.id, database),
      valuations: listCapitalValuations(scope.id, database) });
    saveCapitalReport(report, database);
    saveCapitalBinding({ profileId: input.profileId, scopeId: scope.id, connectionId: input.connectionId,
      mode: 'active', lastBatchId: input.batch.id }, database);
    return report;
  });
}

export function hasActiveCapitalScope(profileId: string, scopeId: string, database: Db): boolean {
  return getCapitalScope(scopeId, database) !== null && listCapitalBindings(profileId, database)
    .some((row) => row.scopeId === scopeId && row.mode === 'active');
}

/** A failed optional projection must not rewrite source evidence or change trading/research execution. */
export function recordCapitalIngestionFailure(provider: CapitalScope['provider'], atMs: number, database: Db): void {
  setSetting(`capital.ingestion_failure.${provider}`, String(atMs), database);
}
