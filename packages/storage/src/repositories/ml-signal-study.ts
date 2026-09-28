import { canonicalJson, type CanonicalJsonValue } from '@coqui/core';
import type { Db } from '../sqlite/index.js';

export interface MlSignalStudy {
  readonly profileId: string; readonly candidateVersion: string;
  readonly registeredAtMs: number; readonly studyEndMs: number;
  readonly datasetHash: string; readonly planHash: string;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>> | null;
}

export function getMlSignalStudy(profileId: string, candidateVersion: string, db: Db): MlSignalStudy | null {
  const row = db.prepare('SELECT * FROM ml_signal_studies_v1 WHERE profile_id=? AND candidate_version=?')
    .get(profileId, candidateVersion) as Record<string, unknown> | undefined;
  return row === undefined ? null : { profileId, candidateVersion,
    registeredAtMs: Number(row['registered_at_ms']), studyEndMs: Number(row['study_end_ms']),
    datasetHash: String(row['dataset_hash']), planHash: String(row['plan_hash']),
    plan: JSON.parse(String(row['plan_json'])) as Record<string, unknown>,
    result: row['result_json'] === null ? null : JSON.parse(String(row['result_json'])) as Record<string, unknown> };
}

export function registerMlSignalStudy(study: Omit<MlSignalStudy, 'result'>, db: Db): void {
  db.prepare(`INSERT OR IGNORE INTO ml_signal_studies_v1
    (profile_id,candidate_version,registered_at_ms,study_end_ms,dataset_hash,plan_hash,plan_json,result_json)
    VALUES (?,?,?,?,?,?,?,NULL)`).run(study.profileId, study.candidateVersion, study.registeredAtMs,
      study.studyEndMs, study.datasetHash, study.planHash,
      canonicalJson(study.plan as CanonicalJsonValue));
}

export function finishMlSignalStudy(profileId: string, candidateVersion: string,
  result: Readonly<Record<string, unknown>>, db: Db): void {
  db.prepare(`UPDATE ml_signal_studies_v1 SET result_json=?
    WHERE profile_id=? AND candidate_version=? AND result_json IS NULL`).run(
      canonicalJson(result as CanonicalJsonValue), profileId, candidateVersion);
}
