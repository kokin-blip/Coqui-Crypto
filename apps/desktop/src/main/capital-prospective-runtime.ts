import {STUDY_BEHAVIOR_HASHES,STUDY_BUILD_LOCK_HASH,STUDY_BUILD_REVISION,type Clock,type ProspectiveRuntime} from '@coqui/core';
import {createProspectiveReadService} from '@coqui/services';
import type {Db} from '@coqui/storage';
import {fullApplicationArtifactHash} from './research-provenance.js';
/** Artifact identity is diagnostic; behavior identity is independently frozen by the protocol. */
export function currentProspectiveRuntime():ProspectiveRuntime {
 const behaviorHash=STUDY_BEHAVIOR_HASHES['capital-prospective-study-v1'];
 if(!behaviorHash)throw new Error('prospective_build_identity_unavailable');
 return {behaviorHash,sourceManifestHash:behaviorHash,artifactHash:fullApplicationArtifactHash(),lockfileHash:STUDY_BUILD_LOCK_HASH,codeRevision:STUDY_BUILD_REVISION};
}
/** Boot exposes local reads only. Owner collection has a separately reviewed invocation and lease. */
export function createMainProspectiveRuntime(input:{profileId:string;database:Db;clock:Clock;runtime?:()=>ProspectiveRuntime}){
 let identity:ProspectiveRuntime|undefined;const runtime=input.runtime??(()=>identity??=currentProspectiveRuntime());
 return {reads:createProspectiveReadService(input.profileId,input.database,()=>input.clock.nowMs(),runtime)};
}
