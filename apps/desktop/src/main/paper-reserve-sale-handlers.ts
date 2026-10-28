import type {ChannelRequest} from '@coqui/contracts';
import type {ProfileOperationGate} from '@coqui/services';
import type {createMainPaperReserveRuntime} from './paper-reserve-runtime.js';
import type {ChannelHandlers} from './dispatch.js';
import {createIsolatedRequestDeadline,withinDeadline,type RequestDeadline} from '@coqui/adapters';
export function createPaperReserveSaleHandlers(c:{runtime:ReturnType<typeof createMainPaperReserveRuntime>;gate?:ProfileOperationGate;operationAllowed:()=>boolean;now?:()=>number;refresh:(deadline:RequestDeadline)=>Promise<void>}):ChannelHandlers{
  const run=<T>(fn:()=>T)=>{try{return {ok:true as const,value:fn()};}catch(error){const code=error instanceof Error?error.message:'';
    if(/^(?:sale_|paper_(?:capital|reserve|book)_|budget_(?:authority|revision|source|capacity)_)[a-z_]+$/u.test(code))return {ok:false as const,issues:[{path:[],code}]};throw error;}};
  const write=<T>(fn:()=>T)=>{if(!c.operationAllowed()||c.gate&&!c.gate.begin())return {ok:false as const,issues:[{path:[],code:'profile_operation_in_progress'}]};try{return run(fn);}finally{c.gate?.end();}};
  return {
    'paper.reserve.sale.status':()=>run(()=>c.runtime.sale.status()),
    'paper.reserve.sale.preview':(r:ChannelRequest<'paper.reserve.sale.preview'>)=>run(()=>c.runtime.sale.preview(r)),
    'paper.reserve.sale.proposals':()=>run(()=>c.runtime.sale.proposals()),
    'paper.reserve.sale.prepare':(r:ChannelRequest<'paper.reserve.sale.prepare'>)=>write(()=>c.runtime.sale.prepare(r)),
    'paper.reserve.sale.order.preview':(r:ChannelRequest<'paper.reserve.sale.order.preview'>)=>write(()=>c.runtime.sale.orderPreview(r)),
    'paper.reserve.sale.order.review':(r:ChannelRequest<'paper.reserve.sale.order.review'>)=>write(()=>c.runtime.sale.review(r)),
    'paper.reserve.sale.reconcile':(r:ChannelRequest<'paper.reserve.sale.reconcile'>)=>write(()=>c.runtime.sale.reconcile(r)),
    'paper.reserve.sale.observe':async(r:ChannelRequest<'paper.reserve.sale.observe'>)=>{
      if(!c.operationAllowed()||c.gate&&!c.gate.begin())return {ok:false as const,issues:[{path:[],code:'profile_operation_in_progress'}]};
      const deadline=createIsolatedRequestDeadline(c.now??Date.now,10000);
      try{if(c.runtime.sale.status().scopeId===null)return {ok:false as const,issues:[{path:[],code:'sale_book_required'}]};
        const v=c.runtime.service.view();if(r.bookId!==v.book.id||r.scopeId!==v.binding.scope_id||r.generation!==v.binding.generation||r.policyId!==v.binding.policy_id||r.stateId!==v.binding.state_id||r.budgetRevision!==v.budget?.revision||r.authorityHash!==v.authorityHash)return {ok:false as const,issues:[{path:[],code:'sale_consequence_stale_or_unavailable'}]};
        await withinDeadline(c.refresh(deadline),deadline);await c.runtime.refreshMarketEvidence(deadline);deadline.check();if(!c.operationAllowed())return {ok:false as const,issues:[{path:[],code:'profile_operation_in_progress'}]};
        c.runtime.sale.disarm();return run(()=>c.runtime.service.observe(r));}catch(error){if(error instanceof Error&&error.message==='deadline_exceeded')return {ok:false as const,issues:[{path:[],code:'sale_observation_deadline'}]};throw error;}finally{deadline.dispose();c.gate?.end();}
    },
  };
}
