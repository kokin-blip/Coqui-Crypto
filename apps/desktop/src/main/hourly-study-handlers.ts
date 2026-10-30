import { previewHourlyStudy, restartHourlyStudy, type ProfileOperationGate } from '@coqui/services';
import { isAuthoritativeHost, type Db } from '@coqui/storage';
import type { Clock } from '@coqui/core';
import type { ChannelHandlers } from './dispatch.js';
import { fullApplicationArtifactHash } from './research-provenance.js';

export function createHourlyStudyHandlers(input: { profileId: string; hostId: string; database: Db; clock: Clock;
  operationGate?: ProfileOperationGate; artifactHash?: () => string }) {
  const proposal = () => ({ profileId: input.profileId, db: input.database, nowMs: input.clock.nowMs(),
    artifactHash: (input.artifactHash ?? fullApplicationArtifactHash)() });
  const failure = (error: unknown) => ({ ok: false as const, issues: [{ path: [], code:
    error instanceof Error && ['experiment_not_active', 'study_not_registered', 'hourly_candidate_version_changed',
      'invalid_study_instance', 'hourly_study_preview_stale', 'command_conflict'].includes(error.message)
      ? error.message : 'hourly_study_unavailable' }] });
  return {
    'parallel.paper.hourly-study.preview': () => {
      try {
        const preview = previewHourlyStudy(proposal()), definition = preview.definition;
        return { ok: true, value: { previewHash: preview.previewHash, alreadyRegistered: preview.alreadyRegistered,
          previousStudyId: preview.previousStudyId, artifactHash: preview.artifactHash,
          behaviorHash: definition.behaviorHash, startMs: definition.startMs,
          foldEndsMs: definition.foldEndsMs, holdoutEndMs: definition.holdoutEndMs,
          opening: definition.opening, costVersion: definition.costVersion } };
      } catch (error) { return failure(error); }
    },
    'parallel.paper.hourly-study.restart': (payload: { commandId: string; previewHash: string }) => {
      if (!isAuthoritativeHost(input.profileId, input.hostId, input.database))
        return { ok: false, issues: [{ path: [], code: 'stale_host_authority' }] };
      if (input.operationGate && !input.operationGate.begin())
        return { ok: false, issues: [{ path: [], code: 'connection_operation_in_progress' }] };
      try {
        const instance = restartHourlyStudy({ ...proposal(), ...payload });
        return { ok: true, value: { studyInstanceId: instance.id, startMs: instance.definition.startMs } };
      } catch (error) { return failure(error); }
      finally { input.operationGate?.end(); }
    },
  } as ChannelHandlers;
}
