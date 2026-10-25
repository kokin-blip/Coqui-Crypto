import { paperReservePolicySchema, paperReserveStateSchema, paperReserveProposalSchema } from '@coqui/contracts';
import { capitalHash, canonicalJson, sha256Hex, identifiedBudgetFact, budgetAmount, type CanonicalJsonValue, type PaperReservePolicy, type PaperReserveState, type PaperReserveProposal, type PaperReserveAuthorityProof, type CapitalFeasibilityInputV1 } from '@coqui/core';
import type { Db } from '../sqlite/index.js';
const tables = { policy: 'paper_reserve_policy_versions_v1', state: 'paper_reserve_state_revisions_v1', proposal: 'paper_reserve_proposals_v1', requirements: 'paper_reserve_requirements_v1', assessment: 'paper_reserve_assessments_v1', event: 'paper_reserve_events_v1', command: 'paper_reserve_commands_v1' } as const;
type Kind = keyof typeof tables;
const json = (v: unknown) => canonicalJson(v as CanonicalJsonValue);
export function readPaperReserveFact<T>(kind: Kind, id: string, db: Db): T | null {
  const row = db.prepare(`SELECT content_json,content_hash FROM ${tables[kind]} WHERE id=?`).get(id) as {content_json:string;content_hash:string} | undefined;
  if (!row) return null;
  if (sha256Hex(row.content_json) !== row.content_hash) throw new Error('paper_reserve_integrity');
  const value = JSON.parse(row.content_json) as {id:string};
  if (identifiedBudgetFact(value).id !== id) throw new Error('paper_reserve_identity');
  return value as T;
}
function append(kind: Kind, value: {readonly id:string;readonly scopeId:string}, columns: Record<string,string|null>, db: Db): void {
  if (identifiedBudgetFact(value).id !== value.id) throw new Error('paper_reserve_identity');
  const prior = readPaperReserveFact(kind,value.id,db);
  if (prior) { if (json(prior) !== json(value)) throw new Error('paper_reserve_conflict'); return; }
  const fields = { id:value.id, scope_id:value.scopeId,...columns,content_json:json(value),content_hash:capitalHash(value) };
  db.prepare(`INSERT INTO ${tables[kind]}(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(()=>'?').join(',')})`).run(...Object.values(fields));
}
export interface PaperReserveRequirements { readonly id:string; readonly scopeId:string; readonly strategyHash:string; readonly frame: CapitalFeasibilityInputV1; readonly objective:'fixed_request'|'cash_only' }
export function savePaperReserveRequirements(value: PaperReserveRequirements, db: Db): void { append('requirements',value,{},db); }
export function savePaperReservePolicy(value: PaperReservePolicy, db: Db): void {
  paperReservePolicySchema.parse(value);
  const req=readPaperReserveFact<PaperReserveRequirements>('requirements',value.requirementsId,db);
  if (!req || req.scopeId !== value.scopeId || req.strategyHash !== capitalHash(value.strategy)) throw new Error('paper_reserve_requirements_identity');
  append('policy',value,{previous_id:value.previousId,requirements_id:value.requirementsId},db);
}
export function savePaperReserveState(value: PaperReserveState, db: Db): void {
  paperReserveStateSchema.parse(value);
  if(value.previousId) { const p=readPaperReserveFact<PaperReserveState>('state',value.previousId,db);
    if(!p || p.scopeId!==value.scopeId || p.streamId!==value.streamId || budgetAmount(value.hUsd).lt(p.hUsd) || budgetAmount(value.allocatedUsd).lt(p.allocatedUsd) || budgetAmount(value.profitBackedTaxUsd).lt(p.profitBackedTaxUsd)) throw new Error('paper_reserve_state_lineage'); }
  append('state',value,{stream_id:value.streamId,policy_id:value.policyId,previous_id:value.previousId,operation_key:value.operationKey},db);
}
export function savePaperReserveProposal(value: PaperReserveProposal, db: Db): void {
  paperReserveProposalSchema.parse(value);append('proposal',value,{policy_id:value.policyId,state_id:value.stateId},db);
}
export interface PaperReserveAssessment { readonly id:string; readonly scopeId:string; readonly streamId:string; readonly operationKey:string; readonly proposalId:string; readonly beforeId:string; readonly afterId:string; readonly claimIds:readonly string[]; readonly authorityHash:string; readonly authorityProof:PaperReserveAuthorityProof }
export function savePaperReserveAssessment(value: PaperReserveAssessment, db: Db): void { append('assessment',value,{stream_id:value.streamId,operation_key:value.operationKey,proposal_id:value.proposalId,before_id:value.beforeId,after_id:value.afterId},db); }
export function appendPaperReserveEvent(scopeId:string, content: {readonly operationKey:string;readonly kind:string;readonly atMs:number;readonly refs:readonly string[]}, db:Db): void { append('event',identifiedBudgetFact({scopeId,...content}),{},db); }
export function listPaperReserveFacts<T>(kind: Kind, scopeId:string, db:Db): T[] {
  const rows=db.prepare(`SELECT id FROM ${tables[kind]} WHERE scope_id=? ORDER BY rowid LIMIT 10001`).all(scopeId) as {id:string}[];
  if(rows.length>10_000) throw new Error('paper_reserve_capacity');return rows.map(r=>readPaperReserveFact<T>(kind,r.id,db)!);
}
export function paperReserveCommand<T>(scopeId:string, commandId:string, requestHash:string, db:Db): T|null {
  const row=db.prepare('SELECT id FROM paper_reserve_commands_v1 WHERE scope_id=? AND command_id=?').get(scopeId,commandId) as {id:string}|undefined;
  if(!row)return null;const receipt=readPaperReserveFact<{requestHash:string;response:T}>('command',row.id,db)!;
  if(receipt.requestHash!==requestHash)throw new Error('paper_reserve_command_conflict');return receipt.response;
}
export function savePaperReserveCommand(scopeId:string,commandId:string,requestHash:string,response:unknown,db:Db):void {
  append('command',identifiedBudgetFact({scopeId,commandId,requestHash,response}),{command_id:commandId},db);
}
