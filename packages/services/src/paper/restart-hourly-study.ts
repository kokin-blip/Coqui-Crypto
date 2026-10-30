import { canonicalJson, createStudyInstance, HOURLY_EXECUTION_V1, sha256Hex, STUDY_BEHAVIOR_HASHES, type CanonicalJsonValue } from '@coqui/core';
import { appendRemediationEvidence, getHourlyExecutionRecord, inTransaction, latestParallelExperiment, listParallelEvents,
  listRemediationEvidence, listStudyInstances, parallelExperimentStatus, registerStudyInstance, type Db } from '@coqui/storage';
import { validateCandidateInstance } from '../research/registered-study.js';
import { PARALLEL_TRENDVOL_VERSION } from './parallel-signal.js';

type Input = { profileId: string; db: Db; nowMs: number; artifactHash: string };
const COMMANDS = 'hourly-study-commands-v1';

/** A deterministic preview: the clock affects only the next UTC-midnight boundary. */
export function previewHourlyStudy(input: Input) {
  const candidate = HOURLY_EXECUTION_V1.id, behaviorHash = STUDY_BEHAVIOR_HASHES[candidate]!;
  const experiment = latestParallelExperiment(input.profileId, input.db);
  if (!experiment || parallelExperimentStatus(listParallelEvents(experiment.id, input.profileId, input.db)) === 'stopped') throw new Error('experiment_not_active');
  const current = listStudyInstances(input.profileId, candidate, input.db).at(-1);
  let reusable = false;
  if (current && current.definition.holdoutEndMs > input.nowMs) {
    try { validateCandidateInstance(current, experiment.id); reusable = true; } catch { /* Changed provenance needs a fresh namespace. */ }
  }
  const prior = current?.definition.candidateDefinition ?? getHourlyExecutionRecord(input.profileId, 'study', candidate, input.db)?.body;
  if (!prior || typeof prior !== 'object' || Array.isArray(prior)) throw new Error('study_not_registered');
  const plan = prior as Record<string, unknown>;
  if (plan['planHash'] !== sha256Hex(canonicalJson(HOURLY_EXECUTION_V1))) throw new Error('hourly_candidate_version_changed');
  const oldStart = plan['startMs'], oldEnd = plan['holdoutEndMs'], oldFolds = plan['foldEndsMs'];
  if (typeof oldStart !== 'number' || typeof oldEnd !== 'number' || !Array.isArray(oldFolds) ||
      oldFolds.some((end) => typeof end !== 'number')) throw new Error('invalid_study_instance');
  const day = 86_400_000, startMs = reusable ? current!.definition.startMs : (Math.floor(input.nowMs / day) + 1) * day;
  const foldEndsMs = (oldFolds as number[]).map((end) => startMs + end - oldStart);
  const holdoutEndMs = startMs + oldEnd - oldStart;
  const candidateDefinition = { ...plan, experimentId: experiment.id, startMs, foldEndsMs, holdoutEndMs,
    holdoutStartMs: foldEndsMs.at(-1), sourceHash: behaviorHash, sourceContentHash: behaviorHash } as CanonicalJsonValue;
  const definition = { version: 1 as const, profileId: input.profileId, experimentId: experiment.id,
    candidateId: candidate, signalVersion: PARALLEL_TRENDVOL_VERSION, policyVersion: candidate,
    executionVersion: 'hourly_virtual_v1', costVersion: 'hourly_fee_25bps_slippage_15bps_v1',
    dataVersion: 'coinbase_completed_daily_alpaca_us_quotes_v1', behaviorHash, candidateDefinition,
    opening: 'common_cash_100000' as const, startMs, foldEndsMs, holdoutEndMs };
  if (!reusable) createStudyInstance(definition, input.nowMs, input.artifactHash);
  const material = { profileId: input.profileId, experimentId: experiment.id, artifactHash: input.artifactHash,
    previousStudyId: current?.id ?? null, legacyHash: current ? null : sha256Hex(canonicalJson(prior as CanonicalJsonValue)),
    definition, alreadyRegistered: reusable };
  return { previewHash: sha256Hex(canonicalJson(material as unknown as CanonicalJsonValue)), ...material };
}

/** Explicit owner action; collectors never register or restart studies. */
export function restartHourlyStudy(input: Input & { previewHash?: string; commandId?: string }) {
  return inTransaction(input.db, () => {
    if (input.commandId) {
      const receipt = listRemediationEvidence(input.profileId, COMMANDS, 'restart', input.db).find(row => row.key === input.commandId);
      if (receipt) {
        const body = receipt.body as { previewHash: string; studyInstanceId: string };
        if (body.previewHash !== input.previewHash) throw new Error('command_conflict');
        const instance = listStudyInstances(input.profileId, HOURLY_EXECUTION_V1.id, input.db).find(row => row.id === body.studyInstanceId);
        if (!instance) throw new Error('invalid_study_instance');
        return instance;
      }
    }
    const preview = previewHourlyStudy(input);
    if (input.previewHash && input.previewHash !== preview.previewHash) throw new Error('hourly_study_preview_stale');
    const instance = preview.alreadyRegistered ? listStudyInstances(input.profileId, HOURLY_EXECUTION_V1.id, input.db).at(-1)!
      : createStudyInstance(preview.definition, input.nowMs, input.artifactHash);
    registerStudyInstance(instance, input.db);
    if (input.commandId) appendRemediationEvidence({ profileId: input.profileId, namespace: COMMANDS, kind: 'restart',
      key: input.commandId, atMs: input.nowMs, body: { previewHash: preview.previewHash, studyInstanceId: instance.id } }, input.db);
    return instance;
  });
}
