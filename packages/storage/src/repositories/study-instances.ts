import { createStudyInstance, type StudyInstance, type CanonicalJsonValue } from '@coqui/core';
import { appendRemediationEvidence, listRemediationEvidence } from './remediation-evidence.js';
import type { Db } from '../sqlite/index.js';

/** Explicit owner registration port. Collectors must never call this. */
export function registerStudyInstance(instance: StudyInstance, db: Db): boolean {
  if (createStudyInstance(instance.definition, instance.registeredAtMs, instance.artifactHash).id !== instance.id)
    throw new Error('invalid_study_instance_identity');
  return appendRemediationEvidence({ profileId: instance.definition.profileId, namespace: 'study-instances-v1',
    kind: 'study', key: instance.id, atMs: instance.registeredAtMs, body: instance as unknown as CanonicalJsonValue }, db);
}
export function listStudyInstances(profileId: string, candidateId: string, db: Db): StudyInstance[] {
  return listRemediationEvidence(profileId, 'study-instances-v1', 'study', db)
    .map((record) => record.body as unknown as StudyInstance).filter((instance) => instance.definition.candidateId === candidateId);
}
