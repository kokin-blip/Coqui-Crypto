import type { ChannelRequest } from '@coqui/contracts';
import { getPaperCapitalBook, type Db } from '@coqui/storage';
import type { ProfileOperationGate } from '@coqui/services';
import type { ChannelHandlers } from './dispatch.js';
import type { createMainPaperReserveRuntime } from './paper-reserve-runtime.js';
/** Only the new cash book uses these bounded operations; legacy handlers retain their behavior. */
export function paperCapitalExecutionOperations(input:{profileId:string;database:Db;runtime:ReturnType<typeof createMainPaperReserveRuntime>;refresh:()=>Promise<void>;gate?:ProfileOperationGate}) {
  const run=async<T>(action:()=>Promise<T>|T,refresh=true)=>{
    if(input.gate&&!input.gate.begin())return {ok:false as const,issues:[{path:[],code:'profile_operation_in_progress'}]};
    try {if(refresh){await input.refresh();await input.runtime.refreshMarketEvidence();}return {ok:true as const,value:await action()};}
    catch(error){const code=error instanceof Error?error.message:'';if(/^(paper_(?:reserve|capital|book)_|budget_(?:authority|revision|source)_)/u.test(code))return{ok:false as const,issues:[{path:[],code}]};throw error;}
    finally{input.gate?.end();}
  };
  return {
    prepare:(commandId:string)=>run(()=>input.runtime.prepare(commandId)),
    reviewHandlers(legacy:ChannelHandlers):ChannelHandlers{return {
      ...legacy,
      'paper.execution.preview':async(r:ChannelRequest<'paper.execution.preview'>)=>getPaperCapitalBook(input.profileId,input.database)?run(()=>input.runtime.execution().preview(r.proposalId)):legacy['paper.execution.preview']!(r as never),
      'paper.execution.review':async(r:ChannelRequest<'paper.execution.review'>)=>getPaperCapitalBook(input.profileId,input.database)?run(()=>input.runtime.execution().review(r),false):legacy['paper.execution.review']!(r as never),
    };},
  };
}
