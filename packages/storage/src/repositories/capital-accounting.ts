import {
  capitalEpochSchema, capitalEventSchema, capitalPerformanceReportSchema, capitalScopeSchema,
  capitalSourceBatchSchema, capitalValuationSchema,
} from '@coqui/contracts';
import {
  capitalDecimal, capitalEventIdentity, capitalHash, capitalScopeId, canonicalJson, sha256Hex,
  type CanonicalJsonValue, type CapitalEventRevision, type CapitalPerformanceReport, type CapitalScope,
  type CapitalSourceBatch, type CapitalTrackingEpoch, type CapitalValuation,
} from '@coqui/core';

import type { Db } from '../sqlite/index.js';
import { listVerifiedWalletIdentities, connectionEligible } from './connection-lifecycle.js';
import { getProfileConnectionV2 } from './connections-v2.js';
import { getSetting } from './settings.js';

type Fact = CapitalScope | CapitalSourceBatch | CapitalEventRevision | CapitalTrackingEpoch | CapitalValuation | CapitalPerformanceReport;
type Table = 'capital_scopes_v1' | 'capital_source_batches_v1' | 'capital_event_revisions_v1' |
  'capital_tracking_epochs_v1' | 'capital_valuation_evidence_v1' | 'capital_performance_reports_v1';

function json(value: unknown): string { return canonicalJson(value as CanonicalJsonValue); }
function read<T>(table: Table, id: string, database: Db): T | null {
  const row = database.prepare(`SELECT content_json,content_hash FROM ${table} WHERE id=?`).get(id) as
    { content_json: string; content_hash: string } | undefined;
  if (!row) return null;
  if (sha256Hex(row.content_json) !== row.content_hash) throw new Error('Capital evidence integrity failed.');
  return JSON.parse(row.content_json) as T;
}
function append(table: Table, id: string, value: Fact, columns: Readonly<Record<string, string | number | null>>, database: Db): boolean {
  const body = json(value), prior = read<Fact>(table, id, database);
  if (prior !== null) {
    if (json(prior) !== body) throw new Error('Capital evidence identity conflict.');
    return false;
  }
  const fields = { id, ...columns, content_json: body, content_hash: sha256Hex(body) };
  database.prepare(`INSERT INTO ${table} (${Object.keys(fields).join(',')}) VALUES (${Object.keys(fields).map(() => '?').join(',')})`)
    .run(...Object.values(fields));
  return true;
}
function list<T>(table: Table, scopeId: string, database: Db): readonly T[] {
  const rows = database.prepare(`SELECT id FROM ${table} WHERE scope_id=? ORDER BY rowid LIMIT 100001`).all(scopeId) as { id: string }[];
  if (rows.length > 100_000) throw new RangeError('capital_evidence_capacity_exceeded');
  return rows.map(({ id }) => read<T>(table, id, database)!);
}

export function getCapitalScope(id: string, database: Db): CapitalScope | null { return read('capital_scopes_v1', id, database); }
export function saveCapitalScope(input: CapitalScope, database: Db): CapitalScope {
  const value = capitalScopeSchema.parse(input);
  if (capitalScopeId(value.provider, value.environment, value.accountIdentityHash) !== value.id) throw new TypeError('Capital scope identity mismatch.');
  const prior = getCapitalScope(value.id, database);
  if (prior !== null) {
    if (prior.provider !== value.provider || prior.environment !== value.environment || prior.accountIdentityHash !== value.accountIdentityHash) {
      throw new Error('Capital scope conflict.');
    }
    return prior;
  }
  append('capital_scopes_v1', value.id, value, { provider: value.provider, environment: value.environment,
    account_identity_hash: value.accountIdentityHash, currency: value.currency }, database);
  return value;
}

export interface CapitalScopeBinding {
  readonly profileId: string; readonly scopeId: string; readonly connectionId: string | null;
  readonly mode: 'active' | 'archived' | 'disconnected'; readonly lastBatchId: string | null;
}
export function listCapitalBindings(profileId: string, database: Db): readonly CapitalScopeBinding[] {
  const rows = database.prepare(`SELECT profile_id,scope_id,connection_id,mode,last_batch_id FROM capital_scope_bindings_v1
    WHERE profile_id=? ORDER BY scope_id`).all(profileId) as {
      profile_id: string; scope_id: string; connection_id: string | null; mode: CapitalScopeBinding['mode']; last_batch_id: string | null;
    }[];
  return rows.map((row) => ({ profileId: row.profile_id, scopeId: row.scope_id, connectionId: row.connection_id, mode: row.mode, lastBatchId: row.last_batch_id }));
}
export function saveCapitalBinding(value: CapitalScopeBinding, database: Db): void {
  if (!value.profileId || !['active', 'archived', 'disconnected'].includes(value.mode)) throw new TypeError('Invalid capital access binding.');
  const prior = listCapitalBindings(value.profileId, database).find((row) => row.scopeId === value.scopeId);
  if (prior?.mode === 'archived' && value.mode === 'active') throw new Error('Archived capital evidence requires a fresh verified binding.');
  database.prepare(`INSERT INTO capital_scope_bindings_v1(profile_id,scope_id,connection_id,mode,last_batch_id) VALUES(?,?,?,?,?)
    ON CONFLICT(profile_id,scope_id) DO UPDATE SET connection_id=excluded.connection_id,mode=excluded.mode,last_batch_id=excluded.last_batch_id`)
    .run(value.profileId, value.scopeId, value.connectionId, value.mode, value.lastBatchId);
}

/** Explicit connection verification can restore read access; it grants no trading/transfer authority or new coverage. */
export function rebindCapitalScopeAfterVerification(profileId: string, scopeId: string, connectionId: string | null, database: Db): boolean {
  const scope = getCapitalScope(scopeId, database);
  if (!scope || scope.provider === 'local_paper' || connectionId === null) return false;
  const connection = getProfileConnectionV2(profileId, connectionId, database);
  const verified = scope.provider === 'alpaca'
    ? connectionId.startsWith('alpaca:') && sha256Hex(connectionId.slice(7).toLowerCase()) === scope.accountIdentityHash &&
      sha256Hex((getSetting('alpaca.paper.account.id', database) ?? '').toLowerCase()) === scope.accountIdentityHash
    : connection !== null && connectionEligible(connection, database) && listVerifiedWalletIdentities(profileId, database).some((row) =>
      row.connection_id === connectionId && row.identity_hash === scope.accountIdentityHash &&
      row.provider === (scope.provider === 'robinhood' ? 'robinhood_crypto' : scope.provider));
  if (!verified) return false;
  database.prepare("UPDATE capital_scope_bindings_v1 SET mode='active',connection_id=?,last_batch_id=NULL WHERE profile_id=? AND scope_id=? AND mode='archived'")
    .run(connectionId, profileId, scopeId);
  return true;
}

export function saveCapitalSourceBatch(input: CapitalSourceBatch, database: Db): boolean {
  const value = capitalSourceBatchSchema.parse(input);
  return append('capital_source_batches_v1', value.id, value, { scope_id: value.scopeId, observed_at_ms: value.observedAtMs }, database);
}
export function saveCapitalValuation(input: CapitalValuation, database: Db): boolean {
  const value = capitalValuationSchema.parse(input);
  for (const amount of [value.equityUsd, value.cashUsd]) if (amount !== null) capitalDecimal(amount);
  for (const leg of value.legs) { capitalDecimal(leg.quantity); if (leg.valueUsd !== null) capitalDecimal(leg.valueUsd); }
  const source = read<CapitalSourceBatch>('capital_source_batches_v1', value.sourceBatchId, database);
  if (source?.scopeId !== value.scopeId) throw new TypeError('Capital valuation source mismatch.');
  const prior = read<CapitalValuation>('capital_valuation_evidence_v1', value.id, database);
  if (prior !== null) {
    const financial = (row: CapitalValuation) => ({ atMs: row.atMs, sequence: row.sequence, equityUsd: row.equityUsd,
      cashUsd: row.cashUsd, legs: row.legs, verified: row.verified, missingComponents: row.missingComponents, replacesId: row.replacesId });
    if (json(financial(prior)) !== json(financial(value))) throw new Error('Capital valuation conflict.');
    return false;
  }
  if (value.replacesId !== null) {
    const replaced = read<CapitalValuation>('capital_valuation_evidence_v1', value.replacesId, database);
    if (replaced?.scopeId !== value.scopeId || replaced.atMs !== value.atMs || replaced.sequence !== value.sequence) {
      throw new TypeError('Capital valuation correction mismatch.');
    }
  }
  return append('capital_valuation_evidence_v1', value.id, value, { scope_id: value.scopeId, source_batch_id: value.sourceBatchId,
    replaces_id: value.replacesId, at_ms: value.atMs, sequence: value.sequence }, database);
}
export function saveCapitalEvent(input: CapitalEventRevision, database: Db): boolean {
  const value = capitalEventSchema.parse(input);
  const identity = capitalEventIdentity(value);
  if (identity.id !== value.id || identity.revisionHash !== value.revisionHash) throw new TypeError('Capital event hash mismatch.');
  for (const amount of [value.externalFlowUsd, value.feeUsd, value.incomeUsd, value.confirmedUserReceiptUsd]) if (amount !== null) capitalDecimal(amount);
  for (const leg of value.legs) { capitalDecimal(leg.quantity); if (leg.valueUsd !== null) capitalDecimal(leg.valueUsd); }
  const source = read<CapitalSourceBatch>('capital_source_batches_v1', value.sourceBatchId, database);
  if (source?.scopeId !== value.scopeId) throw new TypeError('Capital event source mismatch.');
  const prior = read<CapitalEventRevision>('capital_event_revisions_v1', value.id, database);
  if (prior !== null) {
    if (capitalEventIdentity(prior).revisionHash !== value.revisionHash || prior.logicalKey !== value.logicalKey) throw new Error('Capital event conflict.');
    return false;
  }
  if (value.replacesId !== null) {
    const replaced = read<CapitalEventRevision>('capital_event_revisions_v1', value.replacesId, database);
    if (!replaced || replaced.scopeId !== value.scopeId || replaced.logicalKey !== value.logicalKey || value.correctionAuthority === null) {
      throw new TypeError('Capital correction lineage mismatch.');
    }
    if (value.correctionAuthority === 'status_transition' && (replaced.status !== 'pending' || value.status === 'pending' ||
      json(replaced.legs) !== json(value.legs) || replaced.kind !== value.kind)) throw new TypeError('Invalid capital status transition.');
  } else if (value.correctionAuthority !== null) throw new TypeError('Capital correction predecessor required.');
  return append('capital_event_revisions_v1', value.id, value, { scope_id: value.scopeId, source_batch_id: value.sourceBatchId,
    logical_key: value.logicalKey, revision_hash: value.revisionHash, replaces_id: value.replacesId }, database);
}
export function saveCapitalEpoch(input: CapitalTrackingEpoch, database: Db): boolean {
  const value = capitalEpochSchema.parse(input);
  const opening = read<CapitalValuation>('capital_valuation_evidence_v1', value.openingValuationId, database);
  if (opening?.scopeId !== value.scopeId || !opening.verified) throw new TypeError('Verified economic opening required.');
  if (value.predecessorId !== null && read<CapitalTrackingEpoch>('capital_tracking_epochs_v1', value.predecessorId, database)?.scopeId !== value.scopeId) {
    throw new TypeError('Capital epoch lineage mismatch.');
  }
  return append('capital_tracking_epochs_v1', value.id, value, { scope_id: value.scopeId,
    opening_valuation_id: value.openingValuationId, predecessor_id: value.predecessorId }, database);
}
export function saveCapitalReport(input: CapitalPerformanceReport, database: Db): boolean {
  const value = capitalPerformanceReportSchema.parse(input);
  const prior = database.prepare('SELECT id FROM capital_performance_reports_v1 WHERE scope_id=? AND epoch_id IS ? ORDER BY rowid DESC LIMIT 1')
    .get(value.scopeId, value.epochId) as { id: string } | undefined;
  return append('capital_performance_reports_v1', value.inputHash, value, { scope_id: value.scopeId, epoch_id: value.epochId,
    calculation_version: value.calculationVersion, supersedes_id: prior?.id === value.inputHash ? null : prior?.id ?? null }, database);
}
export const listCapitalSourceBatches = (scopeId: string, db: Db): readonly CapitalSourceBatch[] => list('capital_source_batches_v1', scopeId, db);
export const listCapitalEvents = (scopeId: string, db: Db): readonly CapitalEventRevision[] => list('capital_event_revisions_v1', scopeId, db);
export const listCapitalValuations = (scopeId: string, db: Db): readonly CapitalValuation[] => list('capital_valuation_evidence_v1', scopeId, db);
export const listCapitalEpochs = (scopeId: string, db: Db): readonly CapitalTrackingEpoch[] => list('capital_tracking_epochs_v1', scopeId, db);
export const getCapitalReport = (inputHash: string, db: Db): CapitalPerformanceReport | null => read('capital_performance_reports_v1', inputHash, db);

export function capitalFactsHash(scopeId: string, database: Db): string {
  return capitalHash({ batches: listCapitalSourceBatches(scopeId, database), events: listCapitalEvents(scopeId, database), valuations: listCapitalValuations(scopeId, database) });
}
