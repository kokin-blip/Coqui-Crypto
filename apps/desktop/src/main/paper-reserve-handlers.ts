import type { ChannelRequest } from '@coqui/contracts';
import { createPaperCapitalBook, type PaperProfitReserveService, type ProfileOperationGate } from '@coqui/services';
import { getPaperCapitalBook, getPaperCapitalBookById, paperReserveBinding, type Db } from '@coqui/storage';
import type { ChannelHandlers } from './dispatch.js';
/** Main supplies profile/clock/model/authority. The renderer supplies no evidence or permission flags. */
export function createPaperReserveHandlers(profileId:string,db:Db,now:()=>number,service:PaperProfitReserveService,gate?:ProfileOperationGate,refreshMarketEvidence?:()=>Promise<void>,disarmSaleDrafts?:()=>void):ChannelHandlers {
  const run=<T>(fn:()=>T)=>{try{return{ok:true as const,value:fn()};}catch(error){const code=error instanceof Error?error.message:'';
    if(/^(paper_(?:reserve|capital|book|origin|fill|ledger|balances)_|budget_(?:authority|revision|source|capacity)_)/u.test(code))return{ok:false as const,issues:[{path:[],code}]};throw error;}};
  const write=<T>(fn:()=>T)=>{if(gate&&!gate.begin())return{ok:false as const,issues:[{path:[],code:'profile_operation_in_progress'}]};try{return run(fn);}finally{gate?.end();}};
  return {
    'paper.reserve.books':()=>run(()=>{const b=paperReserveBinding(profileId,db),book=getPaperCapitalBook(profileId,db)??(b?getPaperCapitalBookById(b.book_id,db):null);return book?[{book,archived:b?.archived===1,disabled:b?.disabled!==0}]:[];}),
    'paper.reserve.view':()=>run(()=>service.view()),'paper.reserve.preview':()=>run(()=>service.preview()),'paper.reserve.operations':()=>run(()=>service.operations()),
    'paper.reserve.book.create':(r:ChannelRequest<'paper.reserve.book.create'>)=>write(()=>createPaperCapitalBook({profileId,bookId:r.bookId,commandId:r.commandId,openingUsd:r.openingUsd,atMs:now()},db)),
    'paper.reserve.policy.save':(r:ChannelRequest<'paper.reserve.policy.save'>)=>write(()=>{disarmSaleDrafts?.();return service.savePolicy(r);}),
    'paper.reserve.observe':async(r:ChannelRequest<'paper.reserve.observe'>)=>{if(gate&&!gate.begin())return{ok:false as const,issues:[{path:[],code:'profile_operation_in_progress'}]};try{await refreshMarketEvidence?.();return run(()=>service.observe(r));}finally{gate?.end();}},
    'paper.reserve.authorize':(r:ChannelRequest<'paper.reserve.authorize'>)=>write(()=>{disarmSaleDrafts?.();return service.authorize(r);}),
    'paper.reserve.pause':(r:ChannelRequest<'paper.reserve.pause'>)=>write(()=>{disarmSaleDrafts?.();return service.pause(r);}),
    'paper.reserve.resume':(r:ChannelRequest<'paper.reserve.resume'>)=>write(()=>{disarmSaleDrafts?.();return service.resume(r);}),
    'paper.reserve.review':(r:ChannelRequest<'paper.reserve.review'>)=>write(()=>service.review(r)),
    'paper.reserve.release':(r:ChannelRequest<'paper.reserve.release'>)=>write(()=>service.release(r)),
  };
}
