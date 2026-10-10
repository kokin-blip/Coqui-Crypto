import type { Clock } from '@coqui/core';
import { readIntegrityWorkspace } from '@coqui/services';
import { migrations, type Db } from '@coqui/storage';
import { buildEvidenceBundle } from './evidence-export.js';
import { readBuildIdentity } from './build-identity.js';
import { readPerformanceTrace } from './performance-trace.js';
import type { ChannelHandlers } from './dispatch.js';
export function createWorkstationHandlers(input: { profileId:string;database:Db;clock:Clock;
  saveEvidence?: (data:string)=>Promise<'saved'|'cancelled'> }) {
  return {
    'app.about':()=>({ok:true,value:{build:readBuildIdentity(),schemaVersion:input.database.prepare('PRAGMA user_version').get()!['user_version'],
      supportedSchemaVersion:migrations.at(-1)!.version,liveExecutionEnabled:false,publication:'unverified'}}),
    'app.performance-trace':()=>({ok:true,value:readPerformanceTrace()}),
    'research.integrity-workspace':()=>({ok:true,value:{studies:readIntegrityWorkspace(input.database)}}),
    'app.evidence-export':async()=>{
      if(!input.saveEvidence)return {ok:false,issues:[{code:'export_destination_unavailable'}]};
      const bundle=buildEvidenceBundle(input.profileId,input.clock.nowMs(),input.database),data=JSON.stringify(bundle,null,2)+'\n';
      if(Buffer.byteLength(data)>1_000_000)return {ok:false,issues:[{code:'export_size_exceeded'}]};
      try { return {ok:true,value:{status:await input.saveEvidence(data),bundleHash:bundle.sanitizedDerivativeHash}}; }
      catch { return {ok:false,issues:[{code:'ambiguous_outcome'}]}; }
    },
  } as ChannelHandlers;
}
