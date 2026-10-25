import { paperCapitalBookSchema } from '@coqui/contracts';
import { capitalHash, canonicalJson, type CanonicalJsonValue, identifiedBudgetFact, sha256Hex, type PaperReservePolicy, type PaperReserveState } from '@coqui/core';
import { type Db } from '../sqlite/index.js';
export type PaperCapitalBook = ReturnType<typeof paperCapitalBookSchema.parse>;
export interface PaperReserveBinding { profile_id: string; book_id: string; scope_id: string; policy_id: string | null; state_id: string | null; requirements_id: string | null; generation: number; archived: number; disabled: number }
export function paperReserveBinding(profileId: string, db: Db): PaperReserveBinding | null {
  return db.prepare('SELECT * FROM paper_reserve_runtime_bindings_v1 WHERE profile_id=?').get(profileId) as unknown as PaperReserveBinding | undefined ?? null;
}
export function getPaperCapitalBook(profileId: string, db: Db): PaperCapitalBook | null {
  const row = db.prepare('SELECT content_json,content_hash FROM paper_capital_book_origins_v1 WHERE origin_profile_id=?').get(profileId) as {content_json:string;content_hash:string} | undefined;
  if (!row) return null;
  if (sha256Hex(row.content_json) !== row.content_hash) throw new Error('paper_book_integrity');
  const value = paperCapitalBookSchema.parse(JSON.parse(row.content_json));
  if (identifiedBudgetFact(value).id !== value.id) throw new Error('paper_book_identity');
  return value;
}
/** Any prior financial/campaign/connection evidence requires a separate new profile. Never convert a legacy book. */
export function assertEmptyPaperCapitalProfile(profileId: string, db: Db): void {
  for (const table of ['strategy_decisions_v1','wallet_decision_runs','paper_execution_proposals_v1','execution_plans_v1','execution_routes_v1','paper_balances_v3','paper_orders_v3','paper_ledger_entries_v3','paper_book_origins_v1','paper_campaign_plans_v2','exploratory_paper_campaigns_v1','multi_connection_paper_campaigns_v1','profile_connections_v1','profile_connections_v2']) {
    if (db.prepare(`SELECT 1 FROM ${table} WHERE profile_id=? LIMIT 1`).get(profileId)) throw new Error('paper_book_requires_empty_dedicated_profile');
  }
  for(const table of ['tax_lots_v2','disposals_v2'])if(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw new Error('paper_book_requires_empty_dedicated_profile');
  if (getPaperCapitalBook(profileId, db) || paperReserveBinding(profileId, db)) throw new Error('paper_book_already_exists');
}
export function insertPaperCapitalBook(book: PaperCapitalBook, scopeId: string, db: Db): void {
  const value = paperCapitalBookSchema.parse(book);
  if (identifiedBudgetFact(value).id !== value.id) throw new Error('paper_book_identity');
  // Called with origin, existing paper balances and P1 opening in the same transaction.
  db.prepare('INSERT INTO paper_capital_book_origins_v1(id,book_id,origin_profile_id,content_json,content_hash) VALUES(?,?,?,?,?)')
    .run(value.id, value.bookId, value.originProfileId, canonicalJson(value as unknown as CanonicalJsonValue), capitalHash(value));
  db.prepare('INSERT INTO paper_reserve_runtime_bindings_v1(profile_id,book_id,scope_id) VALUES(?,?,?)').run(value.originProfileId, value.id, scopeId);
}
export function advancePaperReserveBinding(profileId: string, expectedGeneration: number, values: { policy: PaperReservePolicy | null; state: PaperReserveState | null; disabled: boolean }, db: Db): void {
  const b = paperReserveBinding(profileId, db);
  if (!b || b.archived || b.generation !== expectedGeneration || values.policy && values.policy.scopeId !== b.scope_id || values.state && (values.state.scopeId !== b.scope_id || values.state.policyId !== values.policy?.id)) throw new Error('paper_reserve_binding_stale');
  const result = db.prepare('UPDATE paper_reserve_runtime_bindings_v1 SET policy_id=?,state_id=?,requirements_id=?,disabled=?,generation=generation+1 WHERE profile_id=? AND generation=? AND archived=0')
    .run(values.policy?.id ?? null, values.state?.id ?? null, values.policy?.requirementsId ?? null, values.disabled ? 1 : 0, profileId, expectedGeneration);
  if (result.changes !== 1) throw new Error('paper_reserve_binding_stale');
}
export const paperCapitalScopeIdentity = (book: PaperCapitalBook): string => capitalHash({ version: book.version, bookId: book.bookId, originHash: book.id, originProfileId: book.originProfileId, environment: book.environment, currency: book.currency });

export function assertDedicatedPaperCapitalProfile(profileId:string,db:Db):void {
  for(const table of ['profile_connections_v1','profile_connections_v2','paper_campaign_plans_v2','exploratory_paper_campaigns_v1','multi_connection_paper_campaigns_v1'])if(db.prepare(`SELECT 1 FROM ${table} WHERE profile_id=? LIMIT 1`).get(profileId))throw new Error('paper_reserve_competing_writer');
}

/** Archived access may display original provenance; it cannot redefine the book's originating profile. */
export function getPaperCapitalBookById(id:string,db:Db):PaperCapitalBook|null {
  const row=db.prepare('SELECT content_json,content_hash FROM paper_capital_book_origins_v1 WHERE id=?').get(id) as {content_json:string;content_hash:string}|undefined;
  if(!row)return null;if(sha256Hex(row.content_json)!==row.content_hash)throw new Error('paper_book_integrity');
  const value=paperCapitalBookSchema.parse(JSON.parse(row.content_json));if(value.id!==id || identifiedBudgetFact(value).id!==id)throw new Error('paper_book_identity');return value;
}
