import { accountBudgetEvidenceSchema, budgetReportSchema, cashClaimSchema, capitalFeasibilityReportSchema, nativeExecutionRulesSchema } from '@coqui/contracts';
import { capitalHash, canonicalJson, sha256Hex, budgetEvidence, cashClaim, identifiedBudgetFact,
  projectAccountBudget, type AccountBudgetEvidenceV1, type CashClaimV1, type NativeExecutionRulesV1,
  type BudgetReportV1, type CapitalFeasibilityReportV1, type CanonicalJsonValue } from '@coqui/core';
import { inTransaction, type Db } from '../sqlite/index.js';
import { getCapitalScope, listCapitalBindings } from './capital-accounting.js';

type Table = 'capital_native_rule_evidence_v1' | 'capital_budget_source_evidence_v1' | 'capital_cash_claim_revisions_v1' |
  'capital_budget_reports_v1' | 'capital_feasibility_reports_v1' | 'capital_route_budget_bindings_v1';
const json = (value: unknown) => canonicalJson(value as CanonicalJsonValue);
function get<T>(table: Table, id: string, db: Db): T | null {
  const row = db.prepare(`SELECT content_json,content_hash FROM ${table} WHERE id=?`).get(id) as { content_json: string; content_hash: string } | undefined;
  if (!row) return null;
  if (sha256Hex(row.content_json) !== row.content_hash) throw new Error('budget_evidence_integrity');
  return JSON.parse(row.content_json) as T;
}
function append(table: Table, value: { readonly id: string }, columns: Record<string, string | number | null>, db: Db): boolean {
  if (identifiedBudgetFact(value).id !== value.id) throw new Error('budget_fact_identity');
  const prior = get(table, value.id, db); if (prior !== null) { if (json(prior) !== json(value)) throw new Error('budget_fact_conflict'); return false; }
  const fields = { id: value.id, ...columns, content_json: json(value), content_hash: capitalHash(value) };
  db.prepare(`INSERT INTO ${table}(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(() => '?').join(',')})`).run(...Object.values(fields));
  return true;
}
function list<T>(table: Table, scopeId: string, db: Db): T[] {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE scope_id=? ORDER BY rowid LIMIT 10001`).all(scopeId) as { id: string }[];
  if (rows.length > 10_000) throw new Error('budget_evidence_capacity');
  return rows.map(row => get<T>(table, row.id, db)!);
}
export const getNativeExecutionRules = (id: string, db: Db) => get<NativeExecutionRulesV1>('capital_native_rule_evidence_v1', id, db);
export function saveNativeExecutionRules(input: NativeExecutionRulesV1, db: Db): boolean {
  const value = nativeExecutionRulesSchema.parse(input);
  return append('capital_native_rule_evidence_v1', value, { asset_id: value.assetId, observed_at_ms: value.observedAtMs }, db);
}
export const getBudgetSource = (id: string, db: Db) => get<AccountBudgetEvidenceV1>('capital_budget_source_evidence_v1', id, db);
export const listCashClaims = (scopeId: string, db: Db) => list<CashClaimV1>('capital_cash_claim_revisions_v1', scopeId, db);
export function budgetCheckpoint(scopeId: string, db: Db): { source_id: string; generation: number; conflict: number } | null {
  return db.prepare('SELECT source_id,generation,conflict FROM capital_budget_checkpoints_v1 WHERE scope_id=?').get(scopeId) as
    { source_id: string; generation: number; conflict: number } | undefined ?? null;
}
export function saveBudgetSource(input: AccountBudgetEvidenceV1, db: Db): boolean {
  const value = accountBudgetEvidenceSchema.parse(input), scope = getCapitalScope(value.scopeId, db);
  if (!scope || scope.provider !== value.provider || scope.environment !== value.environment || scope.accountIdentityHash !== value.bookId) throw new Error('budget_scope_identity');
  for (const id of value.ruleIds) if (getNativeExecutionRules(id, db) === null) throw new Error('budget_rule_missing');
  if (budgetEvidence(value).id !== value.id) throw new Error('budget_source_identity');
  return inTransaction(db, () => {
    const added = append('capital_budget_source_evidence_v1', value, { scope_id: value.scopeId, observed_at_ms: value.observedAtMs }, db);
    const prior = budgetCheckpoint(value.scopeId, db), previous = prior === null ? null : getBudgetSource(prior.source_id, db);
    if (prior === null) db.prepare('INSERT INTO capital_budget_checkpoints_v1(scope_id,source_id,generation) VALUES(?,?,0)').run(value.scopeId, value.id);
    else if (previous!.observedAtMs < value.observedAtMs) db.prepare('UPDATE capital_budget_checkpoints_v1 SET source_id=?,generation=generation+1,conflict=0 WHERE scope_id=?')
      .run(value.id, value.scopeId);
    else if (previous!.observedAtMs === value.observedAtMs && previous!.id !== value.id) {
      // Simultaneous conflicting observations cannot be ordered by receipt time.
      db.prepare('UPDATE capital_budget_checkpoints_v1 SET conflict=1 WHERE scope_id=?').run(value.scopeId);
    }
    return added;
  });
}
export function saveCashClaim(input: CashClaimV1, db: Db): boolean {
  const value = cashClaimSchema.parse(input), scope = getCapitalScope(value.scopeId, db);
  if (!scope || cashClaim(value).id !== value.id) throw new Error('budget_claim_identity');
  if (value.purpose === 'profit_reserve' || value.purpose === 'tax_hold') throw new Error('p2_funded_reserves_disabled');
  if (value.replacesId !== null) {
    const prior = get<CashClaimV1>('capital_cash_claim_revisions_v1', value.replacesId, db);
    if (!prior || prior.scopeId !== value.scopeId || prior.originKey !== value.originKey || prior.assetId !== value.assetId || prior.purpose !== value.purpose) throw new Error('budget_claim_lineage');
    if ((prior.state === 'settled' || prior.state === 'released') && prior.state !== value.state) throw new Error('budget_claim_terminal');
  }
  return append('capital_cash_claim_revisions_v1', value, { scope_id: value.scopeId, origin_key: value.originKey, replaces_id: value.replacesId }, db);
}
export function currentBudget(scopeId: string, nowMs: number, db: Db): BudgetReportV1 | null {
  const checkpoint = budgetCheckpoint(scopeId, db); if (!checkpoint) return null;
  const source = getBudgetSource(checkpoint.source_id, db)!;
  return projectAccountBudget(checkpoint.conflict ? { ...source, complete: false, reasonCodes: [...source.reasonCodes, 'budget_source_conflict'] } : source, listCashClaims(scopeId, db), nowMs);
}
export function saveBudgetReport(input: BudgetReportV1, db: Db): boolean {
  const value = budgetReportSchema.parse(input), old = list<BudgetReportV1>('capital_budget_reports_v1', value.scopeId, db).at(-1);
  return append('capital_budget_reports_v1', value, { scope_id: value.scopeId, source_id: value.sourceId, supersedes_id: old?.id ?? null }, db);
}
export function saveFeasibilityReport(input: CapitalFeasibilityReportV1, db: Db): boolean {
  const value = capitalFeasibilityReportSchema.parse(input), old = list<CapitalFeasibilityReportV1>('capital_feasibility_reports_v1', value.scopeId, db).at(-1);
  if (capitalHash(JSON.parse(value.inputsJson)) !== value.inputManifest.inputHash) throw new Error('feasibility_input_integrity');
  const budget = getBudgetReport(value.inputManifest.budgetId, db);
  if (!budget || budget.scopeId !== value.scopeId || budget.revision !== value.budgetRevision) throw new Error('feasibility_budget_identity');
  return append('capital_feasibility_reports_v1', value, { scope_id: value.scopeId, budget_id: value.inputManifest.budgetId, supersedes_id: old?.id ?? null }, db);
}
export const getBudgetReport = (id: string, db: Db) => get<BudgetReportV1>('capital_budget_reports_v1', id, db);
export const getFeasibilityReport = (id: string, db: Db) => get<CapitalFeasibilityReportV1>('capital_feasibility_reports_v1', id, db);
export function proposalFeasibilityReport(scopeId: string, proposalId: string, db: Db): CapitalFeasibilityReportV1 | null {
  return list<CapitalFeasibilityReportV1>('capital_feasibility_reports_v1', scopeId, db).filter(row => row.inputManifest.proposal?.id === proposalId).at(-1) ?? null;
}
export interface CapitalRouteBudgetBinding { readonly id: string; readonly scopeId: string; readonly routeId: string;
  readonly budgetRevision: string; readonly assumptionHash: string }
export function saveCapitalRouteBudgetBinding(input: Omit<CapitalRouteBudgetBinding, 'id'>, db: Db): void {
  append('capital_route_budget_bindings_v1', identifiedBudgetFact(input), { scope_id: input.scopeId }, db);
}
export function capitalRouteBudgetBinding(scopeId: string, routeId: string, db: Db): CapitalRouteBudgetBinding | null {
  return list<CapitalRouteBudgetBinding>('capital_route_budget_bindings_v1', scopeId, db).find(row => row.routeId === routeId) ?? null;
}

/** Explicit successor after an authoritative local ledger transaction; never receipt-order correction. */
export function advanceLocalBudgetSource(input: AccountBudgetEvidenceV1, expectedSourceId: string, db: Db): void {
  inTransaction(db, () => {
    const prior = budgetCheckpoint(input.scopeId, db), source = getBudgetSource(expectedSourceId, db);
    if (!source || prior?.source_id !== expectedSourceId || prior.conflict || input.provider !== 'local_paper' ||
      input.bookId !== source.bookId || input.observedAtMs < source.observedAtMs || input.authority !== 'isolated_book') throw new Error('budget_source_revision_stale');
    accountBudgetEvidenceSchema.parse(input);
    if (budgetEvidence(input).id !== input.id) throw new Error('budget_source_identity');
    for (const id of input.ruleIds) if (!getNativeExecutionRules(id, db)) throw new Error('budget_rule_missing');
    append('capital_budget_source_evidence_v1', input, { scope_id: input.scopeId, observed_at_ms: input.observedAtMs }, db);
    db.prepare('UPDATE capital_budget_checkpoints_v1 SET source_id=?,generation=generation+1 WHERE scope_id=? AND source_id=?')
      .run(input.id, input.scopeId, expectedSourceId);
  });
}

/** Only a verified isolated local book can commit an existing OMS intent. No IPC/order port. */
export function withBudgetClaim<T>(profileId: string, scopeId: string, expectedRevision: string, claim: CashClaimV1,
  nowMs: number, db: Db, persistExistingIntent: () => T): T {
  return inTransaction(db, () => {
    const scope = getCapitalScope(scopeId, db), binding = listCapitalBindings(profileId, db).find(row => row.scopeId === scopeId);
    const current = currentBudget(scopeId, nowMs, db);
    if (!scope || scope.originProfileId !== profileId || scope.provider !== 'local_paper' || scope.environment !== 'simulation' || binding?.mode !== 'active' ||
      !current?.executionEligible || claim.scopeId !== scopeId || claim.purpose !== 'order' || claim.state !== 'committed') throw new Error('budget_authority_unavailable');
    if (current.revision !== expectedRevision) throw new Error('budget_revision_stale');
    const source = getBudgetSource(current.sourceId, db)!;
    const next = projectAccountBudget(source, [...listCashClaims(scopeId, db), claim], nowMs);
    if (next.state !== 'available') throw new Error('budget_capacity_exceeded');
    saveCashClaim(claim, db);
    const result = persistExistingIntent();
    db.prepare('UPDATE capital_budget_checkpoints_v1 SET generation=generation+1 WHERE scope_id=?').run(scopeId);
    return result;
  });
}
