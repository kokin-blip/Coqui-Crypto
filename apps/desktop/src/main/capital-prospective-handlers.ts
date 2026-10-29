import type {ChannelRequest} from '@coqui/contracts';
import type {createProspectiveReadService} from '@coqui/services';
import type {ChannelHandlers} from './dispatch.js';
/** Four bounded local reads: no acquisition, governance, worker or financial capability. */
export function createProspectiveHandlers(reads:ReturnType<typeof createProspectiveReadService>):ChannelHandlers{
 const read=<T>(fn:()=>T)=>{try{return {ok:true as const,value:fn()};}catch{return {ok:false as const,issues:[{path:[],code:'prospective_evidence_unavailable'}]};}};
 return {'research.prospective.instances':(r:ChannelRequest<'research.prospective.instances'>)=>read(()=>reads.instances(r.limit)),
 'research.prospective.coverage':(r:ChannelRequest<'research.prospective.coverage'>)=>read(()=>reads.coverage(r.registrationId)),
 'research.prospective.development':(r:ChannelRequest<'research.prospective.development'>)=>read(()=>reads.development(r.registrationId)),
 'research.prospective.report':(r:ChannelRequest<'research.prospective.report'>)=>read(()=>reads.report(r.registrationId,r.reportId))};
}
