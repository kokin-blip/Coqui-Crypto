import { validateCandidateInstance } from './registered-study.js';
import { studySourceMatches, type CanonicalJsonValue, type StudyInstance } from '@coqui/core';
import { appendRemediationEvidence, listRemediationEvidence, listStudyInstances, type Db } from '@coqui/storage';

interface Record { kind: string; key: string; atMs: number; body: unknown; hash?: string }
/** Shared collector/evaluator provenance gate and study-isolated storage facade. */
export function studyCollection(input: { profileId: string; experimentId: string; candidateId: string; db: Db;
  nowMs: number; legacyHash: string; legacyList(kind: string): Record[];
  legacyAppend(kind: string, key: string, body: unknown): unknown }) {
  const instance = listStudyInstances(input.profileId, input.candidateId, input.db).at(-1);
  const namespace = instance?.id ?? null;
  let failure: string | null = null;
  if (instance) {
    try { validateCandidateInstance(instance, input.experimentId); }
    catch { failure = 'registered_study_source_changed'; }
  } else {
    const legacy = input.legacyList('study').at(-1);
    if (!legacy) failure = 'study_not_registered';
    else {
      const body = legacy.body as { sourceContentHash?: string; sourceHash?: string };
      if (!studySourceMatches(body.sourceContentHash ?? body.sourceHash ?? '', input.legacyHash)) failure = 'registered_study_source_changed';
    }
  }
  const list = (kind: string): Record[] => namespace === null ? input.legacyList(kind) :
    kind === 'study' ? [{ kind, key: instance!.id, atMs: instance!.registeredAtMs,
      body: instance!.definition.candidateDefinition ?? instance!.definition }] :
    listRemediationEvidence(input.profileId, namespace, kind, input.db).map((row) => ({ ...row, body: row.body }));
  const append = (kind: string, key: string, body: unknown) => namespace === null ? input.legacyAppend(kind,key,body) :
    appendRemediationEvidence({ profileId: input.profileId, namespace, kind, key, atMs: input.nowMs,
      body: body as CanonicalJsonValue }, input.db);
  if (failure && !list('failure').some((r) => r.key === `provenance:${Math.floor(input.nowMs/14_400_000)}:${failure}`)) append('failure', `provenance:${Math.floor(input.nowMs/14_400_000)}:${failure}`,
    { reason: failure, executionEnabled: false, studyInstanceId: namespace });
  const ready = failure === null && (!instance || (input.nowMs >= instance.definition.startMs && input.nowMs < instance.definition.holdoutEndMs));
  return { instance: instance as StudyInstance | undefined, ready, list, append, namespace,
    sourceHash: instance?.definition.behaviorHash ?? input.legacyHash };
}
