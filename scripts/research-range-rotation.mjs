import { registeredStudyForReport } from '../packages/services/dist/research/registered-study.js';
import { DatabaseSync } from 'node:sqlite';
import { compareRangeRotationStudy, universeHash } from '../packages/core/dist/index.js';
import { listBreakoutHourlyBars, listRangeRotationRecords,
  loadUniverseResearchFrames } from '../packages/storage/dist/index.js';
import { widerUniverseRuntimeSourceHash } from '../apps/desktop/dist/main/wider-universe-runtime.js';

const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const path = option('database'), profileId = option('profile') ?? 'main';
const phase = option('phase') ?? 'development';
if (!path || !['development', 'holdout'].includes(phase)) {
  process.stderr.write('Usage: node scripts/research-range-rotation.mjs --database=/path/to/coqui.db [--profile=main] [--phase=development|holdout]\n');
  process.exitCode = 2;
} else {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const present = db.prepare("SELECT 1 FROM sqlite_master WHERE name='range_rotation_records_v1'").get();
    if (!present) {
      process.stdout.write(`${JSON.stringify({ status: 'not_registered', phase, results: null,
        executionEnabled: false })}\n`);
    } else {
      const registered = registeredStudyForReport({profileId,candidateId:'wider-range-rotation-v1',db,legacyHash:widerUniverseRuntimeSourceHash(),legacyList:(kind,cutoff)=>listRangeRotationRecords(profileId,kind,db,cutoff)});
      const study = registered.study;
      const nowMs = Date.now();
      const cutoff = !study ? 0 : phase === 'development' ? study.holdoutStartMs :
        nowMs < study.endExclusiveMs ? 0 : study.endExclusiveMs;
      const frames = cutoff === 0 ? [] : loadUniverseResearchFrames(profileId, db, cutoff);
      const comparison = study ? compareRangeRotationStudy(study, frames, phase, nowMs,
        registered.sourceHash, (assetId, fromMs, toMs, observedAtMs) =>
          listBreakoutHourlyBars(profileId, assetId, fromMs, toMs, observedAtMs, db)) :
        { status: 'not_registered', phase, results: null };
      const shadows = registered.records('shadow', cutoff);
      const report = { schemaVersion: 1, generatedAtMs: nowMs, phase, studyInstanceId: registered.studyInstanceId, study: study ?? null,
        shadowSlots: shadows.length, latestShadow: shadows.at(-1)?.body ?? null,
        comparison, executionEnabled: false, limitations: [
          'The range benefit proxy is a frozen research assumption, not a calibrated forecast.',
          'Modeled results are not broker fills.',
          'Complete point-in-time eligibility and hourly evidence are required for comparison.',
          'A favorable result cannot activate paper orders.' ] };
      process.stdout.write(`${JSON.stringify({ ...report, reportHash: universeHash(report) }, null, 2)}\n`);
    }
  } catch {
    process.stderr.write('Range rotation report failed; no credentials or provider payloads were printed.\n');
    process.exitCode = 1;
  } finally { db?.close(); }
}
