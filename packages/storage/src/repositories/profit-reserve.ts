import { capitalHash, canonicalJson, identifiedBudgetFact, budgetAmount, type CanonicalJsonValue, type ReservePolicy, type ReserveState, type ReserveAssessment, type ReserveEligibilityReport } from '@coqui/core';
import { reservePolicySchema, reserveStateSchema, reserveAssessmentSchema, reserveEligibilitySchema, reserveInspectionSchema, type ChannelResponse } from '@coqui/contracts';
import { getCapitalScope, listCapitalBindings } from './capital-accounting.js';
import type { Db } from '../sqlite/index.js';

type Inspection = ChannelResponse<'capital.reserve.preview'>;
type Table = 'capital_reserve_policy_versions_v1' | 'capital_reserve_state_revisions_v1' | 'capital_reserve_eligibility_reports_v1' |
  'capital_reserve_preview_reports_v1' | 'capital_reserve_assessments_v1' | 'capital_reserve_commands_v1';
export const reserveCanonicalJson = (value: unknown) => canonicalJson(value as CanonicalJsonValue);
function read<T>(table:Table,id:string,db:Db):T|null{
  const row=db.prepare(`SELECT content_json,content_hash FROM ${table} WHERE id=?`).get(id) as {content_json:string;content_hash:string}|undefined;
  if(!row)return null;const value=JSON.parse(row.content_json) as T;
  if(capitalHash(value)!==row.content_hash)throw new Error('reserve_evidence_integrity');return value;
}
function append(table:Table,value:{readonly id:string},columns:Record<string,string|number|null>,db:Db):boolean{
  if(identifiedBudgetFact(value).id!==value.id)throw new Error('reserve_fact_identity');
  const prior=read(table,value.id,db);if(prior!==null){if(reserveCanonicalJson(prior)!==reserveCanonicalJson(value))throw new Error('reserve_fact_conflict');return false;}
  const fields={id:value.id,...columns,content_json:reserveCanonicalJson(value),content_hash:capitalHash(value)};
  db.prepare(`INSERT INTO ${table}(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(()=>'?').join(',')})`).run(...Object.values(fields));return true;
}
export function reserveFactIds(table:'capital_reserve_preview_reports_v1'|'capital_reserve_eligibility_reports_v1',scopeId:string,db:Db):string[]{
  const rows=db.prepare(`SELECT id FROM ${table} WHERE scope_id=? ORDER BY rowid DESC LIMIT 1001`).all(scopeId) as {id:string}[];
  if(rows.length>1000)throw new Error('reserve_evidence_capacity');return rows.map(r=>r.id);
}
export interface ReserveHead { readonly policy_id:string;readonly state_id:string;readonly generation:number;readonly archived:number }
export function reserveHead(scopeId:string,db:Db):ReserveHead|null{return db.prepare('SELECT policy_id,state_id,generation,archived FROM capital_reserve_preview_heads_v1 WHERE scope_id=?').get(scopeId) as ReserveHead|undefined??null;}
export function assertReserveAccess(profileId:string,scopeId:string,db:Db,edit=false):void{
  const scope=getCapitalScope(scopeId,db),binding=listCapitalBindings(profileId,db).find(r=>r.scopeId===scopeId);
  if(!scope||!binding||edit&&(binding.mode!=='active'||scope.originProfileId!==profileId||reserveHead(scopeId,db)?.archived===1))throw new Error('reserve_scope_unavailable');
}
export const getReservePolicy=(id:string,db:Db)=>{const v=read<ReservePolicy>('capital_reserve_policy_versions_v1',id,db);return v===null?null:reservePolicySchema.parse(v);};
export const getReserveState=(id:string,db:Db)=>{const v=read<ReserveState>('capital_reserve_state_revisions_v1',id,db);return v===null?null:reserveStateSchema.parse(v);};
export const getReserveInspection=(id:string,db:Db)=>{const v=read<Inspection>('capital_reserve_preview_reports_v1',id,db);return v===null?null:reserveInspectionSchema.parse(v);};
export function saveReservePolicy(input:ReservePolicy,db:Db):boolean{
  const v=reservePolicySchema.parse(input),prior=v.previousId===null?null:getReservePolicy(v.previousId,db);
  if(v.previousId!==null&&(!prior||prior.scopeId!==v.scopeId||prior.originProfileId!==v.originProfileId))throw new Error('reserve_policy_lineage');
  return append('capital_reserve_policy_versions_v1',v,{scope_id:v.scopeId,previous_id:v.previousId},db);
}
export function saveReserveState(input:ReserveState,db:Db):boolean{
  const v=reserveStateSchema.parse(input),p=getReservePolicy(v.policyId,db),prior=v.previousId===null?null:getReserveState(v.previousId,db);
  if(!p||p.scopeId!==v.scopeId||v.previousId!==null&&(!prior||prior.scopeId!==v.scopeId||prior.streamId!==v.streamId||budgetAmount(v.hUsd).lt(prior.hUsd)||budgetAmount(v.allocatedUsd).lt(prior.allocatedUsd))||
    budgetAmount(v.reservedUsd).gt(v.allocatedUsd)||budgetAmount(v.profitBackedTaxUsd).gt(v.taxHoldUsd))throw new Error('reserve_state_lineage');
  return append('capital_reserve_state_revisions_v1',v,{scope_id:v.scopeId,stream_id:v.streamId,policy_id:v.policyId,previous_id:v.previousId,operation_key:v.operationKey,domain:v.domain},db);
}
export function saveReserveEligibility(input:ReserveEligibilityReport,db:Db):boolean{
  const v=reserveEligibilitySchema.parse(input),old=reserveFactIds('capital_reserve_eligibility_reports_v1',v.scopeId,db)[0]??null;
  return append('capital_reserve_eligibility_reports_v1',v,{scope_id:v.scopeId,supersedes_id:old},db);
}
export function saveReserveInspection(input:Inspection,db:Db):boolean{
  const v=reserveInspectionSchema.parse(input),report=v.report,p=getReservePolicy(report.policyId,db),s=getReserveState(report.stateId,db);
  if(!p||!s||s.policyId!==p.id||s.scopeId!==report.scopeId||capitalHash(JSON.parse(report.inputsJson))!==report.inputHash)throw new Error('reserve_report_inputs');
  const old=reserveFactIds('capital_reserve_preview_reports_v1',report.scopeId,db)[0]??null;
  return append('capital_reserve_preview_reports_v1',v,{scope_id:report.scopeId,policy_id:report.policyId,state_id:report.stateId,supersedes_id:old},db);
}
export function saveReserveAssessment(input:ReserveAssessment,db:Db):boolean{
  const v=reserveAssessmentSchema.parse(input),before=getReserveState(v.beforeId,db),after=getReserveState(v.afterId,db);
  if(!before||!after||before.scopeId!==v.scopeId||after.previousId!==before.id||after.streamId!==v.streamId||after.event!=='assessment'||
    !budgetAmount(v.hAfterUsd).eq(budgetAmount(v.hBeforeUsd).add(v.assessedProfitUsd))||!budgetAmount(after.reservedUsd).eq(budgetAmount(before.reservedUsd).add(v.reserveUsd)))throw new Error('reserve_assessment_lineage');
  return append('capital_reserve_assessments_v1',v,{scope_id:v.scopeId,stream_id:v.streamId,operation_key:v.operationKey,before_id:v.beforeId,after_id:v.afterId,domain:v.domain},db);
}
export function advanceReserveHead(scopeId:string,policyId:string,stateId:string,expectedStateId:string|null,db:Db):void{
  const prior=reserveHead(scopeId,db),state=getReserveState(stateId,db);
  if(!state||state.scopeId!==scopeId||state.policyId!==policyId||prior?.archived===1|| (prior?.state_id??null)!==expectedStateId)throw new Error('reserve_revision_stale');
  if(prior)db.prepare('UPDATE capital_reserve_preview_heads_v1 SET policy_id=?,state_id=?,generation=generation+1 WHERE scope_id=? AND state_id=? AND archived=0').run(policyId,stateId,scopeId,expectedStateId);
  else db.prepare('INSERT INTO capital_reserve_preview_heads_v1(scope_id,policy_id,state_id,generation) VALUES(?,?,?,0)').run(scopeId,policyId,stateId);
}
interface ReserveCommand {readonly id:string;readonly scopeId:string;readonly commandId:string;readonly requestHash:string;readonly responseJson:string}
export function reserveCommand(scopeId:string,commandId:string,requestHash:string,db:Db):unknown|null{
  const prior=read<ReserveCommand>('capital_reserve_commands_v1',capitalHash({scopeId,commandId}),db);
  if(!prior)return null;if(prior.requestHash!==requestHash)throw new Error('reserve_command_conflict');return JSON.parse(prior.responseJson) as unknown;
}
export function saveReserveCommand(scopeId:string,commandId:string,requestHash:string,response:unknown,db:Db):void{
  // The lookup identity is stable across retries; the stored content hash authenticates its payload.
  const id=capitalHash({scopeId,commandId}),value={id,scopeId,commandId,requestHash,responseJson:reserveCanonicalJson(response)};
  const prior=reserveCommand(scopeId,commandId,requestHash,db);if(prior!==null){if(reserveCanonicalJson(prior)!==value.responseJson)throw new Error('reserve_command_conflict');return;}
  db.prepare('INSERT INTO capital_reserve_commands_v1(id,scope_id,command_id,content_json,content_hash) VALUES(?,?,?,?,?)').run(id,scopeId,commandId,reserveCanonicalJson(value),capitalHash(value));
}

export function reserveAssessmentByOperation(streamId:string,operationKey:string,db:Db):ReserveAssessment|null{
  const row=db.prepare('SELECT id FROM capital_reserve_assessments_v1 WHERE stream_id=? AND operation_key=?').get(streamId,operationKey) as {id:string}|undefined;
  return row?reserveAssessmentSchema.parse(read('capital_reserve_assessments_v1',row.id,db)):null;
}
