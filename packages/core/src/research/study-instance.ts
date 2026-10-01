import { canonicalJson, type CanonicalJsonValue } from '../evidence/decision.js';
import { sha256Hex } from '../crypto/sha256.js';

export interface StudyInstanceDefinition {
  readonly version: 1; readonly profileId: string; readonly experimentId: string; readonly candidateId: string;
  readonly signalVersion: string; readonly policyVersion: string; readonly executionVersion: string;
  readonly costVersion: string; readonly dataVersion: string; readonly behaviorHash: string;
  readonly candidateDefinition?: CanonicalJsonValue;
  readonly opening: 'common_cash_100000'; readonly startMs: number;
  readonly foldEndsMs: readonly number[]; readonly holdoutEndMs: number;
}
export interface StudyInstance { readonly id: string; readonly definition: StudyInstanceDefinition; readonly registeredAtMs: number;
  readonly artifactHash: string }
export function createStudyInstance(definition: StudyInstanceDefinition, registeredAtMs: number, artifactHash: string): StudyInstance {
  const dates = [definition.startMs, ...definition.foldEndsMs, definition.holdoutEndMs];
  if (definition.version !== 1 || definition.opening !== 'common_cash_100000' || [definition.signalVersion,definition.policyVersion,definition.executionVersion,definition.costVersion,definition.dataVersion].some((version) => !version) || !definition.profileId || !definition.experimentId || !definition.candidateId ||
      !/^[a-f0-9]{64}$/u.test(definition.behaviorHash) || !/^[a-f0-9]{64}$/u.test(artifactHash) ||
      !Number.isSafeInteger(registeredAtMs) || registeredAtMs >= definition.startMs || definition.foldEndsMs.length === 0 ||
      dates.some((at, i) => !Number.isSafeInteger(at) || at % 86_400_000 !== 0 || (i > 0 && at <= dates[i-1]!)))
    throw new Error('invalid_study_instance');
  const id = sha256Hex(canonicalJson(definition as unknown as CanonicalJsonValue));
  return { id, definition, registeredAtMs, artifactHash };
}
export function validateStudyProvenance(instance: StudyInstance, expected: {
  profileId: string; experimentId: string; candidateId: string; behaviorHash: string;
}): void {
  const definition = instance.definition;
  if (createStudyInstance(definition, instance.registeredAtMs, instance.artifactHash).id !== instance.id ||
      definition.profileId !== expected.profileId || definition.experimentId !== expected.experimentId ||
      definition.candidateId !== expected.candidateId || definition.behaviorHash !== expected.behaviorHash)
    throw new Error('registered_study_source_changed');
}

export function studySourceMatches(registered: string, current: string): boolean {
  return /^[a-f0-9]{64}$/u.test(registered) && registered === current;
}
