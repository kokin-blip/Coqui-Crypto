import { canonicalJson, createStudyInstance, HOURLY_EXECUTION_V1, sha256Hex, STUDY_BEHAVIOR_HASHES, type CanonicalJsonValue } from '@coqui/core';
import { getHourlyExecutionRecord, latestParallelExperiment, listParallelEvents, listStudyInstances, parallelExperimentStatus, registerStudyInstance, type Db } from '@coqui/storage';
import { PARALLEL_TRENDVOL_VERSION } from './parallel-signal.js';

/** Explicit owner action: a new prospective namespace, never a collector-side restart. */
export function restartHourlyStudy(input: { profileId: string; db: Db; nowMs: number; artifactHash: string }) {
  const candidate = HOURLY_EXECUTION_V1.id, behaviorHash = STUDY_BEHAVIOR_HASHES[candidate]!;
  const experiment = latestParallelExperiment(input.profileId, input.db);
  if (!experiment || parallelExperimentStatus(listParallelEvents(experiment.id, input.profileId, input.db)) === 'stopped') throw new Error('experiment_not_active');
  const current = listStudyInstances(input.profileId, candidate, input.db).at(-1);
  if (current?.definition.behaviorHash === behaviorHash && current.definition.experimentId === experiment.id) return current;
  const prior = current?.definition.candidateDefinition ?? getHourlyExecutionRecord(input.profileId, 'study', candidate, input.db)?.body;
  if (!prior || typeof prior !== 'object' || Array.isArray(prior)) throw new Error('study_not_registered');
  const plan = prior as Record<string, unknown>;
  if (plan['planHash'] !== sha256Hex(canonicalJson(HOURLY_EXECUTION_V1))) throw new Error('hourly_candidate_version_changed');
  const oldStart = plan['startMs'], oldEnd = plan['holdoutEndMs'], oldFolds = plan['foldEndsMs'];
  if (typeof oldStart !== 'number' || typeof oldEnd !== 'number' || !Array.isArray(oldFolds) ||
      oldFolds.some((end) => typeof end !== 'number')) throw new Error('invalid_study_instance');
  const day = 86_400_000, startMs = (Math.floor(input.nowMs / day) + 1) * day;
  const foldEndsMs = (oldFolds as number[]).map((end) => startMs + end - oldStart);
  const holdoutEndMs = startMs + oldEnd - oldStart;
  const candidateDefinition = { ...plan, experimentId: experiment.id, startMs, foldEndsMs, holdoutEndMs,
    holdoutStartMs: foldEndsMs.at(-1), sourceHash: behaviorHash, sourceContentHash: behaviorHash } as CanonicalJsonValue;
  const instance = createStudyInstance({ version: 1, profileId: input.profileId, experimentId: experiment.id,
    candidateId: candidate, signalVersion: PARALLEL_TRENDVOL_VERSION, policyVersion: candidate,
    executionVersion: 'hourly_virtual_v1', costVersion: 'hourly_fee_25bps_slippage_15bps_v1',
    dataVersion: 'coinbase_completed_daily_alpaca_us_quotes_v1', behaviorHash, candidateDefinition,
    opening: 'common_cash_100000', startMs, foldEndsMs, holdoutEndMs }, input.nowMs, input.artifactHash);
  registerStudyInstance(instance, input.db);
  return instance;
}
