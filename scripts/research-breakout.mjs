import { registeredStudyForReport } from '../packages/services/dist/research/registered-study.js';
import { DatabaseSync } from 'node:sqlite';
import { compareBreakoutStudy, universeHash } from '../packages/core/dist/index.js';
import { listBreakoutHourlyBars, listBreakoutRecords, loadUniverseResearchFrames } from '../packages/storage/dist/index.js';
import { widerUniverseRuntimeSourceHash } from '../apps/desktop/dist/main/wider-universe-runtime.js';

const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const path = option('database'), profileId = option('profile') ?? 'main';
const phase = option('phase') ?? 'development';
if (!path || !['development', 'holdout'].includes(phase)) {
  process.stderr.write('Usage: node scripts/research-breakout.mjs --database=/path/to/coqui.db [--profile=main] [--phase=development|holdout]\n');
  process.exitCode = 2;
} else {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const present = db.prepare("SELECT 1 FROM sqlite_master WHERE name='breakout_research_records_v1'").get();
    if (!present) {
      process.stdout.write(`${JSON.stringify({ status: 'not_registered', phase, results: null,
        executionEnabled: false })}\n`);
    } else {
      const registered = registeredStudyForReport({profileId,candidateId:'wider-breakout-v1',db,legacyHash:widerUniverseRuntimeSourceHash(),legacyList:(kind,cutoff)=>listBreakoutRecords(profileId,kind,db,cutoff)});
      const study = registered.study;
      const nowMs = Date.now();
      const cutoff = !study ? 0 : phase === 'development' ? study.holdoutStartMs :
        nowMs < study.endExclusiveMs ? 0 : study.endExclusiveMs;
      const frames = cutoff === 0 ? [] : loadUniverseResearchFrames(profileId, db, cutoff);
      const sourceHash = registered.sourceHash;
      const comparison = study ? compareBreakoutStudy(study, frames, phase, nowMs, sourceHash,
        (assetId, fromMs, toMs, observedAtMs) => listBreakoutHourlyBars(profileId, assetId,
          fromMs, toMs, observedAtMs, db)) : { status: 'not_registered', phase, results: null };
      const shadows = registered.records('shadow', cutoff);
      const report = { schemaVersion: 1, generatedAtMs: nowMs, phase, studyInstanceId: registered.studyInstanceId, study: study ?? null,
        shadowSlots: shadows.length, latestShadow: shadows.at(-1)?.body ?? null, comparison,
        executionEnabled: false, limitations: [
          'Modeled results are not broker fills.',
          'Historical eligibility requires prior-day catalogs and complete recorded slot evidence.',
          'A favorable result does not activate paper orders.' ] };
      process.stdout.write(`${JSON.stringify({ ...report, reportHash: universeHash(report) }, null, 2)}\n`);
    }
  } catch {
    process.stderr.write('Breakout report failed; no credentials or provider payloads were printed.\n');
    process.exitCode = 1;
  } finally { db?.close(); }
}
