import {capitalHash,identifiedBudgetFact,prospectiveFrameReasons,prospectiveRuntimeMatches,advanceProspectiveBook,unavailableProspectiveBook,PROSPECTIVE_DAY as DAY,type ProspectiveRuntime,type ProspectiveFrame,type ProspectiveDesign} from '@coqui/core';
import {inTransaction,requireProspectiveScope,prospectiveCaptureByOperation,prospectiveCaptureMetadata,saveProspectiveCapture,prospectiveCollectionHeads,saveProspectiveBook,advanceProspectiveBinding,prospectiveStoredBytes,type Db} from '@coqui/storage';
import {prospectiveFrameSchema} from '@coqui/contracts';
export interface ProspectiveCollectorPermit {assertCurrent(registrationId:string):void}
export interface ProspectiveSource {acquire(input:{registrationId:string;slotMs:number;signal:AbortSignal}):Promise<ProspectiveFrame>}
/** Explicit-ID and forward-only. Source supplies no financial, registration or order capabilities. */
export function createProspectiveCollector(input:{profileId:string;database:Db;now:()=>number;runtime:()=>ProspectiveRuntime;permit:ProspectiveCollectorPermit;source:ProspectiveSource;assertOperation:()=>void}){
 let busy=false;
 return {async capture(registrationId:string,operationKey:string){
  if(busy)throw new Error('prospective_single_flight');busy=true;let timer:ReturnType<typeof setTimeout>|undefined,failureContext:{design:ProspectiveDesign;slotMs:number}|undefined;
  try {
   input.assertOperation();input.permit.assertCurrent(registrationId);const {design:d,binding:b}=requireProspectiveScope(input.profileId,registrationId,input.database),db=input.database;
   if(b.archived||b.state!=='collecting'||!prospectiveRuntimeMatches(d.runtime,input.runtime()))throw new Error('prospective_collection_not_authorized');
   const retry=prospectiveCaptureByOperation(registrationId,operationKey,db);if(retry)return retry.id;
   const now=input.now(),slotMs=Math.floor(now/DAY)*DAY;if(slotMs<d.startMs||slotMs>d.endMs||now<slotMs+d.protocol.completionDelayMs||now>slotMs+d.protocol.latenessMs)throw new Error('prospective_slot_not_due');
   failureContext={design:d,slotMs};
   const controller=new AbortController();timer=setTimeout(()=>controller.abort(),d.resources.deadlineMs);
   const raw=await Promise.race([input.source.acquire({registrationId,slotMs,signal:controller.signal}),new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('prospective_acquisition_deadline')),{once:true}))]);
   const frame=prospectiveFrameSchema.parse({...raw,recordedAtMs:input.now()}),bytes=new TextEncoder().encode(JSON.stringify(frame)).length;
   if(bytes>d.resources.maxCaptureBytes)throw new Error('prospective_capture_byte_bound');
   return inTransaction(db,()=>{
    input.assertOperation();input.permit.assertCurrent(registrationId);const current=requireProspectiveScope(input.profileId,registrationId,db);if(current.binding.generation!==b.generation)throw new Error('prospective_revision_stale');
    const reasons=prospectiveFrameReasons(d,frame,input.now());if(frame.slotMs!==slotMs)reasons.push('prospective_slot_mismatch');
    const phase=slotMs<d.finalStartMs?'development' as const:'final' as const;
    const sourceHash=capitalHash({...frame,recordedAtMs:0}),prior=prospectiveCaptureMetadata(registrationId,phase,db).filter(x=>x.slotMs===slotMs&&x.accepted);
    if(prior.length){reasons.push(prior.some(x=>x.sourceHash===sourceHash)?'duplicate_capture':'conflicting_capture');}
    const heads=prospectiveCollectionHeads(registrationId,db);if(heads.length&&heads.some(x=>x.slotMs+DAY!==slotMs))reasons.push('prospective_book_continuity_missing');
    const value={registrationId,operationKey,slotMs,phase,accepted:reasons.length===0,reasonCodes:[...new Set(reasons)],atMs:input.now(),sourceHash,frame};const capture={...value,id:capitalHash(value)};saveProspectiveCapture(capture,db);
    let newHead=b.headHash;
    if(capture.accepted){const rows=[];for(const arm of d.arms)for(const opening of d.openings)for(const cost of d.costs){if(controller.signal.aborted||input.now()-now>d.resources.deadlineMs)throw new Error('prospective_acquisition_deadline');input.permit.assertCurrent(registrationId);const old=heads.find(h=>h.armId===arm.id&&h.capitalUsd===opening.capitalUsd&&h.costId===cost.id)??null;let row;try{row=advanceProspectiveBook(d,registrationId,capture.id,frame,arm,opening,cost,old);}catch(error){if(!(error instanceof Error)||!/^replay_(?:outflow_underfunded|negative_cash|lot_ownership)/u.test(error.message))throw error;row=identifiedBudgetFact({...unavailableProspectiveBook(registrationId,capture.id,frame,arm,opening,cost,old,error.message),phase});}saveProspectiveBook(row,db);rows.push(row.id);}newHead=capitalHash(rows);}
    advanceProspectiveBinding(b,{lastSlotMs:capture.accepted?slotMs:b.lastSlotMs,headHash:newHead,...(reasons.includes('conflicting_capture')?{state:'paused' as const,leaseUntilMs:0}:{})},db);
    if(prospectiveStoredBytes(registrationId,db)>d.resources.maxStoredBytes)throw new Error('prospective_disk_bound');return capture.id;
   });
  }catch(error){if(failureContext){try{input.assertOperation();input.permit.assertCurrent(registrationId);const {design:d,slotMs}=failureContext,db=input.database;inTransaction(db,()=>{if(prospectiveCaptureByOperation(registrationId,operationKey,db))return;if(prospectiveStoredBytes(registrationId,db)>=d.resources.maxStoredBytes)return;const body={registrationId,operationKey,slotMs,phase:slotMs<d.finalStartMs?'development' as const:'final' as const,accepted:false,reasonCodes:[error instanceof Error&&error.message==='prospective_acquisition_deadline'?'prospective_acquisition_deadline':'prospective_collection_batch_failed'],atMs:input.now(),sourceHash:capitalHash({operationKey,slotMs,protocol:d.protocol.hash}),frame:null};saveProspectiveCapture({...body,id:capitalHash(body)},db);});}catch{/* Preserve the original error; no checkpoint or outcome is invented. */}}throw error;
  }finally{if(timer)clearTimeout(timer);busy=false;}
 }};
}
