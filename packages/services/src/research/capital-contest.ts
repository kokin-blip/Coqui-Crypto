import {setImmediate} from 'node:timers/promises';
import {capitalHash,capitalReplayJsonBytes,validateCapitalContest,validateContestData,replayContestCell,referenceForTrial,contestDifferences,assembleContestResult,resampleContestData,contestResamplingReasons,
 trialRegistryHash,trialCountForSignificance,type CapitalContestManifestV1,type ContestInputManifestV1,type ContestCellV1,type ContestPathV1,type ContestResultV1} from '@coqui/core';
import {capitalContestManifestSchema,contestInputSchema,contestCellSchema,contestPathSchema} from '@coqui/contracts';
import {appendContestRecord,saveContestValue,readContestValue,saveContestManifest,readContestManifest,readContestCell,readContestPath,readContestResult,contestRecords,contestIds,contestStoredBytes,contestRecordCount,loadTrialRegistry,inTransaction,type Db} from '@coqui/storage';
import {assertOfflineReplayProfile,type CapitalReplayContext,type CapitalReplayRuntime} from './capital-replay.js';
import {assertReplayDevelopmentBoundary} from './capital-replay-data.js';
function compact(m:CapitalContestManifestV1,c:ContestCellV1):ContestCellV1{
 const retain=m.contrasts.some(x=>x.primary&&(x.left===c.trial.armId||x.right===c.trial.armId))&&Number(m.primaryWeights[c.trial.capitalUsd]??0)>0;
 return {...c,decisions:[],result:{...c.result,fills:[],events:[],traces:[],feasibility:[],reservePreviews:[],assessments:[],sleevePerformance:[],totalPerformance:retain?c.result.totalPerformance:[]}};
}
/** Explicit offline invocation. Dependencies expose no provider, registration or financial capabilities. */
export async function runCapitalContest(input:{readonly manifest:CapitalContestManifestV1;readonly loadData:()=>Promise<ContestInputManifestV1>;readonly context:CapitalReplayContext;readonly runtime:CapitalReplayRuntime;readonly now:()=>number;readonly resume:boolean;readonly governanceDb?:Db;readonly signal?:AbortSignal;readonly timeoutMs?:number},db:Db):Promise<ContestResultV1>{
 const m=capitalContestManifestSchema.parse(input.manifest),id=validateCapitalContest(m),started=input.now();
 if(m.replay.originProfileId!==input.context.profileId||m.replay.workspaceId!==input.context.workspaceId||Object.entries(input.runtime).some(([key,value])=>m.replay[key as keyof typeof m.replay]!==value))throw new Error('contest_context_or_runtime_mismatch');
 assertOfflineReplayProfile(db,input.context);
 if(m.supersedesManifestHash!==null){const old=readContestManifest(m.supersedesManifestHash,db);if(!old||old.replay.originProfileId!==m.replay.originProfileId||old.replay.workspaceId!==m.replay.workspaceId)throw new Error('contest_correction_lineage_invalid');}
 const prior=readContestResult(id,db);if(prior)return prior;
 const attempts=contestRecords(id,'contest_attempt',db,100);if(attempts.length&&!input.resume)throw new Error('contest_explicit_resume_required');
 const attempt=capitalHash({id,attempt:attempts.length+1});
 const check=()=>{if(input.signal?.aborted)throw new Error('contest_cancelled');if(input.now()-started>(input.timeoutMs??120000))throw new Error('contest_deadline');input.context.assertCurrent();};
 const save=(kind:'contest_cell'|'contest_path'|'contest_input'|'contest_result',key:string,value:unknown)=>inTransaction(db,()=>{
  check();assertOfflineReplayProfile(db,input.context);if(contestStoredBytes(id,db)+capitalReplayJsonBytes(value)>m.resources.maxOutputBytes)throw new Error('contest_disk_budget');saveContestValue(id,kind,key,value,input.now(),db);if(contestStoredBytes(id,db)>m.resources.maxOutputBytes)throw new Error('contest_disk_budget');if(kind==='contest_result')appendContestRecord(id,'contest_choice',attempt,{...(value as ContestResultV1).choice,manifestHash:id},input.now(),db);check();
 });
 inTransaction(db,()=>{saveContestManifest(m,started,db);appendContestRecord(id,'contest_attempt',attempt,{originProfileId:input.context.profileId,attempt:attempts.length+1,resume:input.resume},started,db);if(contestStoredBytes(id,db)>m.resources.maxOutputBytes)throw new Error('contest_disk_budget');});
 try{
  check();if(m.replay.exposure==='exposed_development'){assertReplayDevelopmentBoundary(m.replay,input.governanceDb??db);assertContestTrialHistory(m,input.governanceDb??db);}
  const stored=readContestValue(id,'contest_input','input',db),data=contestInputSchema.parse(stored??await input.loadData());validateContestData(m,data);check();if(!stored)save('contest_input','input',data);
  async function evaluate(mm:CapitalContestManifestV1,panel:ContestInputManifestV1,persist:boolean){
   const cells:ContestCellV1[]=[],references=new Map<string,ContestCellV1['decisions']>();let bytes=0;
   for(const trial of mm.trials){
    check();let cell=persist?readContestCell(id,trial.id,db):null;
    const arm=mm.arms.find(a=>a.id===trial.armId)!;
    if(!cell){let ref:ContestCellV1['decisions']|undefined;
     if(arm.group==='E'||arm.group==='R'){
      const t=referenceForTrial(mm,trial);ref=references.get(t.id)??(persist?readContestCell(id,t.id,db)?.decisions:undefined);
      if(!ref){const calculated=replayContestCell(mm,panel,t,check);ref=calculated.decisions;}
     }
     cell=contestCellSchema.parse(replayContestCell(mm,panel,trial,check,ref));if(persist)save('contest_cell',trial.id,cell);
    }
    if(mm.arms.some(a=>a.group==='S'&&a.selectable&&a.id===trial.armId)&&mm.candidates.find(c=>c.id===arm.candidateId)?.family==='trend')references.set(trial.id,cell.decisions);
    const small=compact(mm,cell);bytes+=capitalReplayJsonBytes(small);if(bytes>64*1024*1024||capitalReplayJsonBytes([...references])>64*1024*1024)throw new Error('contest_summary_memory_bound');cells.push(small);await setImmediate();
   }
   return cells;
  }
  const cells=await evaluate(m,data,true),paths:ContestPathV1[]=[];let pathBytes=0;const keepPath=(path:ContestPathV1)=>{const small={...path,indices:[],cellHashes:[]};pathBytes+=capitalReplayJsonBytes(small);if(pathBytes>64*1024*1024)throw new Error('contest_summary_memory_bound');paths.push(small);};const pathReasons=contestResamplingReasons(m,data);
  for(let index=0;index<m.inference.resamples;index++){
   check();const prior=readContestPath(id,String(index),db);if(prior){keepPath(prior);continue;}
   let path:ContestPathV1;
   if(pathReasons.length){const body={index,indices:[],dataHash:capitalHash(data),cellHashes:[],differences:Object.fromEntries(m.contrasts.map(c=>[c.id,{status:'unavailable' as const,reasons:pathReasons}])),status:'unavailable' as const};path={...body,id:capitalHash({manifest:id,...body})};}
   else{
    const generated=resampleContestData(m,data,index),mm={...m,dataHash:capitalHash(generated.data),replay:{...m.replay,availabilityBasis:'assumed_publication' as const,marketTapeHash:capitalHash(generated.data.market),pathId:generated.id,seed:(m.inference.seed+index)>>>0}};
    const resampled=await evaluate(mm,generated.data,false),differences=contestDifferences(mm,resampled),body={index,indices:generated.indices,dataHash:capitalHash(generated.data),cellHashes:resampled.map(c=>c.result.id),differences,status:Object.values(differences).every(v=>v.status==='available')?'complete' as const:'unavailable' as const};path=contestPathSchema.parse({...body,id:capitalHash({manifest:id,...body})});
   }
   save('contest_path',String(index),path);keepPath(path);await setImmediate();
  }
  check();if(cells.length!==m.trials.length||paths.length!==m.inference.resamples)throw new Error('contest_inventory_incomplete');
  const result=assembleContestResult(m,cells,paths,pathReasons);save('contest_result','result',result);return readContestResult(id,db)!;
 }catch(error){const raw=error instanceof Error?error.message:'contest_failure';const safe=['contest_cancelled','contest_deadline','contest_disk_budget','contest_summary_memory_bound','replay_lifecycle_changed'].includes(raw)?raw:'contest_input_or_execution_failed';
  appendContestRecord(id,['contest_cancelled','contest_deadline','replay_lifecycle_changed'].includes(safe)?'contest_interrupted':'contest_failure',attempt,{reason:safe},input.now(),db);throw new Error(safe,{cause:error});
 }
}
function summary(profileId:string,id:string,db:Db){
 const m=readContestManifest(id,db);if(!m)throw new Error('contest_run_missing');const result=readContestResult(id,db),attempts=contestRecords(id,'contest_attempt',db,100),latest=attempts.at(-1),failed=contestRecords(id,'contest_failure',db,100).find(e=>e.key===latest?.key),interrupted=contestRecords(id,'contest_interrupted',db,100).find(e=>e.key===latest?.key);
 return {id,originProfileId:m.replay.originProfileId,archived:profileId!==m.replay.originProfileId,atMs:latest?.atMs??0,status:result?'complete' as const:interrupted?'interrupted' as const:failed?'failed' as const:'incomplete' as const,cellCount:m.trials.length,pathCount:m.inference.resamples,completedCells:contestRecordCount(id,'contest_cell',db),completedPaths:contestRecordCount(id,'contest_path',db),choice:result?.choice??null,reason:(failed?.body as {reason:string}|undefined)?.reason??(interrupted?.body as {reason:string}|undefined)?.reason??null};
}
export function readCapitalContestRuns(profileId:string,db:Db,limit=20){return {version:'capital-contest-v1' as const,runs:contestIds(db,limit).map(id=>summary(profileId,id,db))};}
export function readCapitalContestDetail(profileId:string,db:Db,request:{readonly runId:string;readonly page:number;readonly limit:number;readonly cellId:string|null}){
 if(!Number.isSafeInteger(request.page)||request.page<0||request.page>100000||!Number.isSafeInteger(request.limit)||request.limit<1||request.limit>100)throw new Error('contest_page_invalid');
 const m=readContestManifest(request.runId,db);if(!m)throw new Error('contest_run_missing');
 const offset=request.page*request.limit,cells=m.trials.slice(offset,offset+request.limit).flatMap(t=>{const c=readContestCell(request.runId,t.id,db);return c?[{trial:t,state:c.result.state,reasonCodes:c.result.reasonCodes,metrics:c.result.metrics,summary:c.result.summary,targetHash:c.targetHash}]:[];});
 if(request.cellId!==null&&!m.trials.some(t=>t.id===request.cellId))throw new Error('contest_cell_not_found');
 const selected=request.cellId?readContestCell(request.runId,request.cellId,db):null;
 const complete=readContestResult(request.runId,db);let result=null;if(complete){const {cellIds,cellHashes,pathIds,...body}=complete;if(cellIds.length!==cellHashes.length)throw new Error('contest_result_inventory_corrupt');result={...body,cellCount:cellIds.length,pathCount:pathIds.length};}
 const view=(c:ContestCellV1)=>({trial:c.trial,state:c.result.state,reasonCodes:c.result.reasonCodes,metrics:c.result.metrics,summary:c.result.summary,targetHash:c.targetHash});
 const paths=Array.from({length:Math.max(0,Math.min(request.limit,m.inference.resamples-offset))},(_,i)=>readContestPath(request.runId,String(offset+i),db)).flatMap(p=>p?[{id:p.id,index:p.index,status:p.status,dataHash:p.dataHash,cellCount:p.cellHashes.length,differences:p.differences}]:[]);
 return {run:summary(profileId,request.runId,db),manifest:m,cells,selected:selected?view(selected):null,saleConsequences:selected?.saleConsequences.slice(offset,offset+request.limit)??[],paths,result,selectedCellId:selected?.trial.id??null,decisionCount:selected?.decisions.length??0,decisions:selected?.decisions.slice(offset,offset+request.limit)??[],hasMore:m.trials.length>offset+request.limit};
}
/** Reconstruct a single saved conditional path with the exact original runtime. No records are written. */
export async function reconstructCapitalContestPath(input:{readonly runId:string;readonly index:number;readonly trialId:string|null;readonly context:CapitalReplayContext;readonly runtime:CapitalReplayRuntime;readonly check:()=>void},db:Db){
 const m=readContestManifest(input.runId,db),saved=readContestPath(input.runId,String(input.index),db);
 if(!m||!saved||!saved.cellHashes.length||!saved.indices.length||m.replay.originProfileId!==input.context.profileId||Object.entries(input.runtime).some(([k,v])=>m.replay[k as keyof typeof m.replay]!==v))throw new Error('contest_reconstruction_identity_or_evidence');
 assertOfflineReplayProfile(db,input.context);const data=contestInputSchema.parse(readContestValue(input.runId,'contest_input','input',db));validateContestData(m,data);
 const generated=resampleContestData(m,data,input.index),mm={...m,dataHash:capitalHash(generated.data),replay:{...m.replay,availabilityBasis:'assumed_publication' as const,marketTapeHash:capitalHash(generated.data.market),pathId:generated.id,seed:(m.inference.seed+input.index)>>>0}};
 let selected:ContestCellV1|null=null;const hashes:string[]=[];
 for(const t of mm.trials){input.context.assertCurrent();input.check();const arm=mm.arms.find(a=>a.id===t.armId)!;const reference=arm.group==='E'||arm.group==='R'?replayContestCell(mm,generated.data,referenceForTrial(mm,t),input.check).decisions:undefined;
  const cell=replayContestCell(mm,generated.data,t,input.check,reference);hashes.push(cell.result.id);if(t.id===input.trialId)selected=cell;await setImmediate();}
 if(capitalHash(hashes)!==capitalHash(saved.cellHashes)||capitalHash(generated.indices)!==capitalHash(saved.indices)||capitalHash(generated.data)!==saved.dataHash)throw new Error('contest_reconstruction_mismatch');
 return {path:saved,selected};
}

/** Original registry metadata is read only; a new local inventory cannot repair global search gaps. */
export function assertContestTrialHistory(m:CapitalContestManifestV1,db:Db):void{
 if(m.trialHistory.state==='known-lower-bound')return;
 if(Number(db.prepare('SELECT COUNT(*) AS n FROM trial_registry_records').get()?.['n'])>10000)throw new Error('contest_trial_metadata_bound');
 const registry=loadTrialRegistry(db),count=trialCountForSignificance(registry),hash=trialRegistryHash(registry);
 if(count===null||m.trialHistory.registryHash!==hash||!m.trialHistory.evidenceRefs.includes(hash)||m.trialHistory.count<count+m.arms.length*m.scenarios.length||m.trialHistory.state==='complete'&&registry.completeness!=='complete')throw new Error('contest_global_trial_history_unverified');
}
