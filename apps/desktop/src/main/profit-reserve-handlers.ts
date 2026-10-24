import type { ChannelRequest } from '@coqui/contracts';
import { inspectReserve, previewReserve, reserveView, saveReserveSettings, type ProfileOperationGate } from '@coqui/services';
import type { Db } from '@coqui/storage';
import type { ChannelHandlers } from './dispatch.js';
/** Local preview facts only. No provider, order, transfer, scheduler or study client is accepted. */
export function createProfitReserveHandlers(profileId:string,database:Db,now:()=>number,operationGate?:ProfileOperationGate):ChannelHandlers{
  const run=<T>(action:()=>T)=>{try{return {ok:true as const,value:action()};}catch(error){
    const code=error instanceof Error?error.message:'';
    if(['reserve_scope_unavailable','reserve_revision_stale','reserve_source_stale','reserve_command_conflict','reserve_pending_operation_unresolved','reserve_pending_or_scope_conflict','reserve_scenario_inconsistent',
      'reserve_evidence_capacity','capital_evidence_capacity_exceeded','budget_evidence_capacity','capital_scope_unavailable'].includes(code))return {ok:false as const,issues:[{path:[],code}]};throw error;
  }};
  const write=<T>(action:()=>T)=>{
    if(operationGate&&!operationGate.begin())return {ok:false as const,issues:[{path:[],code:'profile_operation_in_progress'}]};
    try{return run(action);}finally{operationGate?.end();}
  };
  return {
    'capital.reserve.view':(request:ChannelRequest<'capital.reserve.view'>)=>run(()=>reserveView(profileId,request.scopeId,now(),database)),
    'capital.reserve.preview':(request:ChannelRequest<'capital.reserve.preview'>)=>run(()=>previewReserve(profileId,request,now(),database)),
    'capital.reserve.settings.save':(request:ChannelRequest<'capital.reserve.settings.save'>)=>write(()=>saveReserveSettings(profileId,request,now(),database)),
    'capital.reserve.inspect':(request:ChannelRequest<'capital.reserve.inspect'>)=>write(()=>inspectReserve(profileId,request,now(),database)),
  };
}
