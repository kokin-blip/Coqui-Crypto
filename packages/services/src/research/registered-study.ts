import { validateStudyProvenance, studySourceMatches, STUDY_BEHAVIOR_HASHES, type StudyInstance } from '@coqui/core';
import { listStudyInstances, listRemediationEvidence, type Db } from '@coqui/storage';

/** Immutable registration validation shared by collecting and reporting. */
export function validateCandidateInstance(instance:StudyInstance, experimentId:string) {
  validateStudyProvenance(instance,{profileId:instance.definition.profileId,experimentId,
    candidateId:instance.definition.candidateId,behaviorHash:STUDY_BEHAVIOR_HASHES[instance.definition.candidateId]??''});
  const config=instance.definition.candidateDefinition;
  if(!config||typeof config!=='object'||Array.isArray(config)) throw new Error('invalid_candidate_definition');
  const object = config as Readonly<Record<string, unknown>>;
  const hash=object['sourceContentHash']??object['sourceHash'];
  if(hash!==instance.definition.behaviorHash || [object['sourceHash'], object['sourceContentHash']].some(value =>
      value !== undefined && value !== instance.definition.behaviorHash) || object['startMs']!==instance.definition.startMs ||
      (object['holdoutEndMs']??object['endExclusiveMs'])!==instance.definition.holdoutEndMs)
    throw new Error('invalid_candidate_definition');
  const ends = object['foldEndsMs'];
  if (Array.isArray(ends) && JSON.stringify(ends) !== JSON.stringify(instance.definition.foldEndsMs))
    throw new Error('invalid_candidate_definition');
  if (typeof object['holdoutStartMs'] === 'number' && object['holdoutStartMs'] !== instance.definition.foldEndsMs.at(-1))
    throw new Error('invalid_candidate_definition');
  return config;
}

/** Read-only namespace facade; never writes a failure or opens a sealed interval. */
export function registeredStudyForReport(input:{profileId:string;candidateId:string;db:Db;legacyHash:string;
  legacyList(kind:string,beforeExclusiveMs?:number):{body:unknown;atMs:number;key:string}[]}) {
  const instance=listStudyInstances(input.profileId,input.candidateId,input.db).at(-1);
  if(instance) {
    const study=validateCandidateInstance(instance,instance.definition.experimentId);
    return {study,sourceHash:instance.definition.behaviorHash,studyInstanceId:instance.id,
      records:(kind:string,cutoff:number)=>listRemediationEvidence(input.profileId,instance.id,kind,input.db,cutoff)};
  }
  const record=input.legacyList('study').at(-1), study=record?.body as {sourceContentHash?:string;sourceHash?:string}|undefined;
  if(study&&!studySourceMatches(study.sourceContentHash??study.sourceHash??'',input.legacyHash)) throw new Error('registered_study_source_changed');
  return {study,sourceHash:input.legacyHash,studyInstanceId:null,records:input.legacyList};
}
