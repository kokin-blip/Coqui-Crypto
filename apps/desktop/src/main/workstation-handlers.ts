import type { Clock } from '@coqui/core';
import { readIntegrityWorkspace } from '@coqui/services';
import { migrations, type Db } from '@coqui/storage';
import { buildEvidenceBundle } from './evidence-export.js';
import { readBuildIdentity } from './build-identity.js';
import { readPerformanceTrace } from './performance-trace.js';
import type { ChannelHandlers } from './dispatch.js';
export function createWorkstationHandlers(input: { profileId:string;database:Db;clock:Clock;
  saveEvidence?: (readData:()=>string)=>Promise<'saved'|'cancelled'> }) {
  return {
    'app.about':()=>({ok:true,value:{build:readBuildIdentity(),schemaVersion:input.database.prepare('PRAGMA user_version').get()!['user_version'],
      supportedSchemaVersion:migrations.at(-1)!.version,liveExecutionEnabled:false,publication:'unverified'}}),
    'app.performance-trace':()=>({ok:true,value:readPerformanceTrace()}),
    'research.integrity-workspace':()=>({ok:true,value:{studies:readIntegrityWorkspace(input.database)}}),
    'app.evidence-export':async()=>{
      if(!input.saveEvidence)return {ok:false,issues:[{code:'export_destination_unavailable'}]};
      let bundleHash='';
      const readData=()=>{
        const bundle=buildEvidenceBundle(input.profileId,input.clock.nowMs(),input.database),data=JSON.stringify(bundle,null,2)+'\n';
        if(Buffer.byteLength(data)>1_000_000)throw new Error('export_size_exceeded');
        bundleHash=bundle.sanitizedDerivativeHash;return data;
      };
      try { readData(); }
      catch { return {ok:false,issues:[{code:'export_preflight_failed'}]}; }
      try { const status=await input.saveEvidence(readData);return {ok:true,value:{status,bundleHash}}; }
      catch { return {ok:false,issues:[{code:'ambiguous_outcome'}]}; }
    },
  } as ChannelHandlers;
}
