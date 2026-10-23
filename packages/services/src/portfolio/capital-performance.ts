import { calculateCapitalPerformance, sha256Hex, type CapitalPerformanceReport } from '@coqui/core';
import {
  connectionEligible, getCapitalScope, getProfileConnectionV2, listCapitalBindings, listCapitalEpochs,
  listCapitalEvents, listCapitalSourceBatches, listCapitalValuations, getSetting, type Db,
} from '@coqui/storage';
import type { ChannelResponse } from '@coqui/contracts';

/** Local-only catalog. Current connection membership is not a financial event. */
export function capitalScopesView(profileId: string, database: Db): ChannelResponse<'capital.scopes'> {
  return { schemaVersion: 1, scopes: listCapitalBindings(profileId, database).map((binding) => {
    const scope = getCapitalScope(binding.scopeId, database)!;
    const batches = listCapitalSourceBatches(scope.id, database);
    const latest = [...batches].sort((a, b) => b.observedAtMs - a.observedAtMs || b.id.localeCompare(a.id))[0];
    const connection = binding.connectionId === null ? null : getProfileConnectionV2(profileId, binding.connectionId, database);
    // Alpaca's existing account route is not a profile_connections_v2 record.
    const alpacaId = getSetting('alpaca.paper.account.id', database);
    const mode = binding.mode === 'active' && (scope.provider === 'alpaca'
      ? alpacaId === null || sha256Hex(alpacaId.toLowerCase()) !== scope.accountIdentityHash
      : binding.connectionId !== null && (connection === null || !connectionEligible(connection, database))) ? 'disconnected' as const : binding.mode;
    const failureAt = Number(getSetting(`capital.ingestion_failure.${scope.provider}`, database) ?? -1);
    const coverage = latest !== undefined && failureAt >= latest.observedAtMs ? { ...latest.coverage, complete: false,
      reasonCodes: [...latest.coverage.reasonCodes, 'capital_ingestion_failed'] } : latest?.coverage ?? null;
    const brokerId = binding.connectionId?.startsWith('alpaca:') ? binding.connectionId.slice(7) : null;
    const label = scope.provider === 'local_paper' ? 'Local paper simulation' : scope.provider === 'alpaca'
      ? `Alpaca paper${brokerId !== null && sha256Hex(brokerId.toLowerCase()) === scope.accountIdentityHash ? ` · ••••${brokerId.slice(-6)}` : ''}`
      : connection?.label || (scope.provider === 'coinbase' ? 'Coinbase account' : 'Robinhood account');
    return { scope, label, mode, connectionId: binding.connectionId, epochs: listCapitalEpochs(scope.id, database),
      latestObservedAtMs: latest?.observedAtMs ?? null, coverage };
  }) };
}

export function capitalPerformanceView(profileId: string, request: {
  readonly scopeId: string; readonly epochId: string | null; readonly fromMs: number | null; readonly toMs: number | null;
}, database: Db): CapitalPerformanceReport {
  const binding = listCapitalBindings(profileId, database).find((row) => row.scopeId === request.scopeId);
  if (!binding) throw new Error('capital_scope_unavailable');
  const scope = getCapitalScope(request.scopeId, database);
  if (!scope) throw new Error('capital_scope_unavailable');
  const epochs = listCapitalEpochs(scope.id, database);
  const epoch = request.epochId === null ? epochs[0] ?? null : epochs.find((row) => row.id === request.epochId);
  if (epoch === undefined) throw new Error('capital_epoch_unavailable');
  return calculateCapitalPerformance({ scope, epoch, fromMs: request.fromMs, toMs: request.toMs,
    batches: listCapitalSourceBatches(scope.id, database), events: listCapitalEvents(scope.id, database),
    valuations: listCapitalValuations(scope.id, database) });
}
