import { assertReplayDevelopmentBoundary } from './capital-replay-data.js';
import { setImmediate } from 'node:timers/promises';
import { capitalReplayJsonBytes, capitalHash, assembleCapitalReplayResult, replayCapitalCell, validateCapitalReplay, type CapitalReplaySpecV1, type CapitalReplayTapeV1,
 type CapitalReplayResultV1, type ReplayCellResult, type CanonicalJsonValue } from '@coqui/core';
import { capitalReplaySpecSchema, capitalReplayTapeSchema } from '@coqui/contracts';
import { appendReplayRecord, readReplayResult, readReplaySpec, replayRecords, replaySpecIds, saveReplayChunks, saveReplaySpec, inTransaction, type Db } from '@coqui/storage';
export interface CapitalReplayContext {readonly profileId:string;readonly workspaceId:string;readonly assertCurrent:()=>void}
export interface CapitalReplayRuntime {readonly codeRevision:string;readonly sourceManifestHash:string;readonly lockfileHash:string}
export function assertOfflineReplayProfile(db:Db,context:CapitalReplayContext):void{
 context.assertCurrent();
 for(const table of ['profile_connections_v1','profile_connections_v2','paper_book_origins_v1','paper_orders_v3','capital_scopes_v1','tax_lots_v2','coinbase_account_evidence_v2','wallet_execution_journal']){
  if(Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.['n'])>0)throw new Error('replay_financial_profile_refused');
 }
}
/** Explicit offline invocation only. The context supplies lifecycle proof, never credentials/financial authority. */
export async function runCapitalReplay(input:{readonly spec:CapitalReplaySpecV1;readonly loadTape:()=>Promise<CapitalReplayTapeV1>;
 readonly context:CapitalReplayContext;readonly runtime:CapitalReplayRuntime;readonly now:()=>number;readonly retry:boolean;
 readonly governanceDb?:Db;readonly signal?:AbortSignal;readonly timeoutMs?:number},db:Db):Promise<CapitalReplayResultV1>{
 const spec=capitalReplaySpecSchema.parse(input.spec),specHash=validateCapitalReplay(spec),started=input.now();
 if(spec.originProfileId!==input.context.profileId||spec.workspaceId!==input.context.workspaceId||Object.entries(input.runtime).some(([k,v])=>spec[k as keyof CapitalReplaySpecV1]!==v))throw new Error('replay_context_or_runtime_mismatch');
 assertOfflineReplayProfile(db,input.context);
 if(spec.supersedesSpecHash!==null){const old=readReplaySpec(spec.supersedesSpecHash,db);if(!old||old.originProfileId!==spec.originProfileId||old.workspaceId!==spec.workspaceId)throw new Error('replay_correction_lineage_invalid');}
 const prior=readReplayResult(specHash,db);if(prior)return prior;
 const attempts=replayRecords(specHash,'capital_replay_attempt',db,100);
 if(attempts.length&&!input.retry)throw new Error('replay_explicit_retry_required');
 const attemptId=capitalHash({specHash,attempt:attempts.length+1});
 inTransaction(db,()=>{
  assertOfflineReplayProfile(db,input.context);saveReplaySpec(spec,started,db);
  if(attempts.length)appendReplayRecord(specHash,'capital_replay_interrupted',attempts.at(-1)!.key,{reason:'superseded_by_explicit_retry',nextAttemptId:attemptId},started,db);
  appendReplayRecord(specHash,'capital_replay_attempt',attemptId,{originProfileId:input.context.profileId,workspaceId:input.context.workspaceId,attempt:attempts.length+1,cells:spec.cells as unknown as CanonicalJsonValue},started,db);
 });
 const check=()=>{if(input.signal?.aborted)throw new Error('replay_cancelled');if(input.now()-started>(input.timeoutMs??120_000))throw new Error('replay_deadline');input.context.assertCurrent();};
 try{
  check();if(spec.exposure==='exposed_development')assertReplayDevelopmentBoundary(spec,input.governanceDb??db);const tape=capitalReplayTapeSchema.parse(await input.loadTape());check();validateCapitalReplay(spec,tape);
  inTransaction(db,()=>{check();saveReplayChunks(specHash,attemptId,'capital_replay_input',tape,input.now(),db);});
  const cells:ReplayCellResult[]=[];let bytes=0;
  for(const cell of spec.cells){check();const result=replayCapitalCell(spec,tape,cell,{check});check();bytes+=capitalReplayJsonBytes(result);
   if(bytes>64*1024*1024)throw new Error('replay_output_bound');cells.push(result);await setImmediate();}
  const result=assembleCapitalReplayResult(spec,cells);
  inTransaction(db,()=>{assertOfflineReplayProfile(db,input.context);check();const manifest=saveReplayChunks(specHash,attemptId,'capital_replay_chunk',result,input.now(),db);
   appendReplayRecord(specHash,'capital_replay_result',attemptId,manifest as unknown as CanonicalJsonValue,input.now(),db);check();});
  return readReplayResult(specHash,db)!;
 }catch(error){
  const raw=error instanceof Error?error.message:'replay_failed';const reason=['replay_cancelled','replay_deadline','replay_lifecycle_changed','replay_output_bound'].includes(raw)?raw:'replay_input_or_execution_failed';
  appendReplayRecord(specHash,reason==='replay_cancelled'||reason==='replay_deadline'||reason==='replay_lifecycle_changed'?'capital_replay_interrupted':'capital_replay_failure',attemptId,{reason},input.now(),db);throw new Error(reason,{cause:error});
 }
}
export function readCapitalReplayRuns(profileId:string,db:Db,limit=20){
 return {version:'capital-aware-replay-v1' as const,runs:replaySpecIds(db,limit).map(id=>replayRunSummary(profileId,id,db))};
}
function replayRunSummary(profileId:string,id:string,db:Db){
 const spec=readReplaySpec(id,db);if(!spec)throw new Error('replay_run_not_found');
 const attempts=replayRecords(id,'capital_replay_attempt',db,100),result=replayRecords(id,'capital_replay_result',db,100).at(-1),attempt=attempts.at(-1);
 const failure=replayRecords(id,'capital_replay_failure',db,100).find(r=>r.key===attempt?.key),interrupted=replayRecords(id,'capital_replay_interrupted',db,100).find(r=>r.key===attempt?.key);
 return {id,specHash:id,originProfileId:spec.originProfileId,recordedAtMs:result?.atMs??attempt?.atMs??0,status:result?'complete' as const:interrupted?'interrupted' as const:failure?'failed' as const:'incomplete' as const,
  archived:profileId!==spec.originProfileId,cellCount:spec.cells.length,codeRevision:spec.codeRevision,exposure:spec.exposure,sourceManifestHash:spec.sourceManifestHash,lockfileHash:spec.lockfileHash,marketTapeHash:spec.marketTapeHash,decisionTapeHash:spec.decisionTapeHash,
  reason:(failure?.body as {reason:string}|undefined)?.reason??(interrupted?.body as {reason:string}|undefined)?.reason??null};
}
export function readCapitalReplayDetail(profileId:string,db:Db,request:{readonly runId:string;readonly cellId:string|null;readonly page:number;readonly limit:number}){
 if(!Number.isSafeInteger(request.page)||request.page<0||request.page>100_000||!Number.isSafeInteger(request.limit)||request.limit<1||request.limit>100)throw new Error('replay_page_invalid');
 const run=replayRunSummary(profileId,request.runId,db),assumptions=readReplaySpec(request.runId,db)!;
 const result=readReplayResult(request.runId,db),view=(c:ReplayCellResult)=>({id:c.id,cell:c.cell,state:c.state,reasonCodes:c.reasonCodes,metrics:c.metrics,summary:c.summary});
 const cells=result?.cells.map(view)??[],selected=result?.cells.find(c=>c.cell.id===(request.cellId??cells[0]?.cell.id));
 if(request.cellId!==null&&result&&!selected)throw new Error('replay_cell_not_found');
 const offset=request.page*request.limit,cut=<T>(rows:readonly T[]|undefined)=>rows?.slice(offset,offset+request.limit)??[];
 return {run,assumptions,cells,selected:selected?view(selected):null,traces:cut(selected?.traces),fills:cut(selected?.fills),events:cut(selected?.events),traceCount:selected?.traces.length??0,fillCount:selected?.fills.length??0,eventCount:selected?.events.length??0,
  hasMore:Math.max(selected?.traces.length??0,selected?.fills.length??0,selected?.events.length??0)>offset+request.limit,limitations:result?.limitations??['Run incomplete; no result or financial authority.']};
}
