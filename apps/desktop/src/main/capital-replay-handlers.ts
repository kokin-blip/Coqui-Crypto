import type { ChannelRequest } from '@coqui/contracts';
import { readCapitalReplayRuns, readCapitalReplayDetail } from '@coqui/services';
import type { Db } from '@coqui/storage';
import type { ChannelHandlers } from './dispatch.js';
/** Local research reads only. No acquisition, runner, file path, scheduler or financial port. */
export function createCapitalReplayHandlers(profileId:string,database:Db):ChannelHandlers{
 const read=<T>(fn:()=>T)=>{try{return {ok:true as const,value:fn()};}catch{return {ok:false as const,issues:[{path:[],code:'capital_replay_evidence_unavailable'}]};}};
 return {
  'research.capital-replay.runs':(request:ChannelRequest<'research.capital-replay.runs'>)=>read(()=>readCapitalReplayRuns(profileId,database,request.limit)),
  'research.capital-replay.detail':(request:ChannelRequest<'research.capital-replay.detail'>)=>read(()=>readCapitalReplayDetail(profileId,database,request)),
 };
}
