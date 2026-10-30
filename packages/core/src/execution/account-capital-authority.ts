import { capitalHash, capitalScopeId } from '../portfolio/capital-ledger.js';

export const ACCOUNT_AUTHORITY_JOURNAL_VERSION = 'account-capital-authority-journal-v1' as const;
const HASH = /^[a-f0-9]{64}$/u;
const PROFILE = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
function keys(value: object, expected: readonly string[]): void {
  if (value === null || typeof value !== 'object' || Object.keys(value).some(key => !expected.includes(key)) ||
    expected.some(key => !Object.hasOwn(value, key))) throw new TypeError('account_authority_fields_invalid');
}

/** References to existing P2 facts, never another cash balance or funded claim. */
export interface AccountAuthorityCheckpoint {
  readonly sourceId: string; readonly claimsRevision: string; readonly claimIds: readonly string[];
  readonly reconciliationId: string;
}
export interface AccountPreparationSession {
  readonly profileId: string; readonly hostIdentityHash: string; readonly generation: number;
  readonly expiresAtMs: number;
}
export interface AccountAuthorityHead {
  readonly id: string; readonly version: typeof ACCOUNT_AUTHORITY_JOURNAL_VERSION;
  readonly registryId: string; readonly scopeId: string; readonly accountIdentityHash: string;
  readonly sequence: number; readonly generation: number; readonly atMs: number;
  readonly requestHash: string; readonly status: 'disabled' | 'quarantined';
  readonly session: AccountPreparationSession | null;
  readonly checkpoint: AccountAuthorityCheckpoint | null;
}
export type AccountAuthorityAction =
  | { readonly kind: 'record_scope'; readonly accountIdentityHash: string }
  | { readonly kind: 'acquire_preparation'; readonly durationMs: number }
  | { readonly kind: 'release_preparation' }
  | { readonly kind: 'record_checkpoint'; readonly checkpoint: AccountAuthorityCheckpoint }
  | { readonly kind: 'quarantine'; readonly reason: 'foreign_activity' | 'source_conflict' | 'restore_uncertain' | 'operator_stop' };
export interface AccountAuthorityCommand {
  readonly id: string; readonly scopeId: string; readonly expectedHeadId: string | null;
  readonly profileId: string; readonly hostIdentityHash: string; readonly atMs: number;
  readonly action: AccountAuthorityAction;
}
export interface AccountCapitalAuthorityView {
  readonly version: typeof ACCOUNT_AUTHORITY_JOURNAL_VERSION; readonly scopeId: string;
  readonly observedAtMs: number; readonly state: 'unavailable'; readonly head: AccountAuthorityHead | null;
  readonly reasonCodes: readonly string[];
  readonly executionPermitted: false; readonly financialClaimsFunded: false;
}
/** This first version can expose evidence only. No available permit can be constructed through it. */
export interface AccountCapitalAuthorityPort {
  read(scopeId: string, atMs: number): AccountCapitalAuthorityView;
}

export function assertAccountAuthorityHash(value: string): void {
  if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError('account_authority_hash_invalid');
}
export function assertAccountAuthorityTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('account_authority_time_invalid');
}
export function validateAccountAuthorityCommand(command: AccountAuthorityCommand): void {
  keys(command, ['id', 'scopeId', 'expectedHeadId', 'profileId', 'hostIdentityHash', 'atMs', 'action']);
  assertAccountAuthorityHash(command.id); assertAccountAuthorityHash(command.scopeId);
  assertAccountAuthorityHash(command.hostIdentityHash); assertAccountAuthorityTime(command.atMs);
  if (command.expectedHeadId !== null) assertAccountAuthorityHash(command.expectedHeadId);
  if (typeof command.profileId !== 'string' || !PROFILE.test(command.profileId)) throw new TypeError('account_authority_profile_invalid');
  switch (command.action.kind) {
    case 'record_scope':
      keys(command.action, ['kind', 'accountIdentityHash']);
      if (capitalScopeId('alpaca', 'paper', command.action.accountIdentityHash) !== command.scopeId) {
        throw new TypeError('account_authority_scope_mismatch');
      }
      break;
    case 'acquire_preparation':
      keys(command.action, ['kind', 'durationMs']);
      if (!Number.isSafeInteger(command.action.durationMs) || command.action.durationMs <= 0 || command.action.durationMs > 30_000) {
        throw new TypeError('account_preparation_duration_invalid');
      }
      assertAccountAuthorityTime(command.atMs + command.action.durationMs);
      break;
    case 'record_checkpoint': {
      keys(command.action, ['kind', 'checkpoint']);
      const checkpoint = command.action.checkpoint;
      keys(checkpoint, ['sourceId', 'claimsRevision', 'claimIds', 'reconciliationId']);
      for (const id of [checkpoint.sourceId, checkpoint.claimsRevision, checkpoint.reconciliationId]) assertAccountAuthorityHash(id);
      if (!Array.isArray(checkpoint.claimIds) || checkpoint.claimIds.length > 100_000 || new Set(checkpoint.claimIds).size !== checkpoint.claimIds.length) {
        throw new TypeError('account_authority_claim_references_invalid');
      }
      checkpoint.claimIds.forEach(assertAccountAuthorityHash);
      break;
    }
    case 'release_preparation': keys(command.action, ['kind']); break;
    case 'quarantine':
      keys(command.action, ['kind', 'reason']);
      if (!['foreign_activity', 'source_conflict', 'restore_uncertain', 'operator_stop'].includes(command.action.reason)) {
        throw new TypeError('account_authority_quarantine_reason_invalid');
      }
      break;
    default: throw new TypeError('account_authority_action_invalid');
  }
}

/** Pure preparation transitions. Expiry never permits takeover or clears a checkpoint. */
export function reduceAccountAuthorityCommand(registryId: string, prior: AccountAuthorityHead | null,
  command: AccountAuthorityCommand): AccountAuthorityHead {
  assertAccountAuthorityHash(registryId); validateAccountAuthorityCommand(command);
  if (command.expectedHeadId !== (prior?.id ?? null)) throw new Error('account_authority_stale_head');
  if (prior && (prior.registryId !== registryId || prior.scopeId !== command.scopeId)) throw new Error('account_authority_scope_mismatch');
  if (prior && command.atMs < prior.atMs) throw new Error('account_authority_clock_regression');
  if (prior?.status === 'quarantined') throw new Error('account_authority_quarantined');
  let generation = prior?.generation ?? 0, session = prior?.session ?? null, checkpoint = prior?.checkpoint ?? null;
  let status: AccountAuthorityHead['status'] = 'disabled';
  let accountIdentityHash: string;
  if (command.action.kind === 'record_scope') {
    if (prior !== null) throw new Error('account_authority_scope_already_recorded');
    accountIdentityHash = command.action.accountIdentityHash;
  } else {
    if (prior === null) throw new Error('account_authority_scope_required');
    accountIdentityHash = prior.accountIdentityHash;
    if (command.action.kind === 'acquire_preparation') {
      if (session !== null) throw new Error(session.expiresAtMs <= command.atMs ? 'account_authority_reconciliation_required' : 'account_preparation_busy');
      generation += 1;
      session = { profileId: command.profileId, hostIdentityHash: command.hostIdentityHash,
        generation, expiresAtMs: command.atMs + command.action.durationMs };
    } else if (command.action.kind === 'quarantine') {
      generation += 1; status = 'quarantined'; // Retain all prior obligations/references and the old session.
    } else {
      if (session === null || session.profileId !== command.profileId || session.hostIdentityHash !== command.hostIdentityHash || session.generation !== generation) {
        throw new Error('account_preparation_owner_mismatch');
      }
      if (command.atMs >= session.expiresAtMs) throw new Error('account_authority_reconciliation_required');
      if (command.action.kind === 'release_preparation') { generation += 1; session = null; }
      else checkpoint = { ...command.action.checkpoint, claimIds: [...command.action.checkpoint.claimIds].sort() };
    }
  }
  const body = { version: ACCOUNT_AUTHORITY_JOURNAL_VERSION, registryId, scopeId: command.scopeId,
    accountIdentityHash,
    sequence: (prior?.sequence ?? 0) + 1, generation, atMs: command.atMs, requestHash: capitalHash(command), status, session, checkpoint };
  return { ...body, id: capitalHash(body) };
}

export function accountCapitalAuthorityView(scopeId: string, atMs: number, head: AccountAuthorityHead | null): AccountCapitalAuthorityView {
  assertAccountAuthorityHash(scopeId); assertAccountAuthorityTime(atMs);
  if (head !== null && head.scopeId !== scopeId) throw new Error('account_authority_scope_mismatch');
  const reasonCodes = ['account_authority_disabled', 'account_topology_and_enrollment_unverified',
    'account_dispatch_enforcement_unimplemented', 'account_financial_evidence_unverified'];
  if (head === null) reasonCodes.push('account_authority_scope_unrecorded');
  if (head?.status === 'quarantined') reasonCodes.push('account_authority_quarantined');
  if (head && atMs < head.atMs) reasonCodes.push('account_authority_observation_precedes_head');
  if (head?.session && atMs >= head.session.expiresAtMs) reasonCodes.push('account_authority_reconciliation_required');
  return { version: ACCOUNT_AUTHORITY_JOURNAL_VERSION, scopeId, observedAtMs: atMs, state: 'unavailable', head,
    reasonCodes, executionPermitted: false, financialClaimsFunded: false };
}
