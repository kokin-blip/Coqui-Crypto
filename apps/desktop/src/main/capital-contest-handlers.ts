import type {ChannelRequest} from '@coqui/contracts';
import {readCapitalContestRuns,readCapitalContestDetail} from '@coqui/services';
import type {Db} from '@coqui/storage';
import type {ChannelHandlers} from './dispatch.js';
/** Local bounded reads. No runner, file loader, scheduler, registration or financial port. */
export function createCapitalContestHandlers(profileId:string,db:Db):ChannelHandlers{
 const read=<T>(fn:()=>T)=>{try{return {ok:true as const,value:fn()};}catch{return {ok:false as const,issues:[{path:[],code:'capital_contest_evidence_unavailable'}]};}};
 return {'research.capital-contest.runs':(r:ChannelRequest<'research.capital-contest.runs'>)=>read(()=>readCapitalContestRuns(profileId,db,r.limit)),
  'research.capital-contest.detail':(r:ChannelRequest<'research.capital-contest.detail'>)=>read(()=>readCapitalContestDetail(profileId,db,r))};
}
