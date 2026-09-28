import { DatabaseSync } from 'node:sqlite';
import { compareMarketSelectorStudy, universeHash } from '../packages/core/dist/index.js';
import { listBreakoutHourlyBars, listMarketSelectorRecords,
  loadUniverseResearchFrames } from '../packages/storage/dist/index.js';
import { widerUniverseRuntimeSourceHash } from '../apps/desktop/dist/main/wider-universe-runtime.js';

const option = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const path = option('database'), profileId = option('profile') ?? 'main';
const phase = option('phase') ?? 'development';
if (!path || !['development', 'holdout'].includes(phase)) {
  process.stderr.write('Usage: node scripts/research-market-selector.mjs --database=/path/to/coqui.db [--profile=main] [--phase=development|holdout]\n');
  process.exitCode = 2;
} else {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const present = db.prepare("SELECT 1 FROM sqlite_master WHERE name='market_selector_records_v1'").get();
    if (!present) process.stdout.write(`${JSON.stringify({ status: 'not_registered', phase,
      results: null, executionEnabled: false })}\n`);
    else {
      const study = listMarketSelectorRecords(profileId, 'study', db).at(-1)?.body;
      const nowMs = Date.now();
      const cutoff = !study ? 0 : phase === 'development' ? study.holdoutStartMs :
        nowMs < study.endExclusiveMs ? 0 : study.endExclusiveMs;
      const frames = cutoff === 0 ? [] : loadUniverseResearchFrames(profileId, db, cutoff);
      const comparison = study ? compareMarketSelectorStudy(study, frames, phase, nowMs,
        widerUniverseRuntimeSourceHash(), (assetId, fromMs, toMs, observedAtMs) =>
          listBreakoutHourlyBars(profileId, assetId, fromMs, toMs, observedAtMs, db)) :
        { status: 'not_registered', phase, results: null };
      const shadows = listMarketSelectorRecords(profileId, 'shadow', db,
        cutoff || Number.MAX_SAFE_INTEGER);
      const report = { schemaVersion: 1, generatedAtMs: nowMs, phase, study: study ?? null,
        shadowSlots: shadows.length, latestShadow: shadows.at(-1)?.body ?? null,
        comparison, executionEnabled: false, limitations: [
          'The selector is shadow-only; Alpaca orders remain TrendVol-controlled.',
          'Replay uses immediate virtual fills and modeled costs, not observed broker fills.',
          'Complete point-in-time universe and required daily/hourly evidence are needed for comparison.',
          'A favorable comparison cannot activate paper orders.' ] };
      process.stdout.write(`${JSON.stringify({ ...report, reportHash: universeHash(report) }, null, 2)}\n`);
    }
  } catch {
    process.stderr.write('Market selector report failed; no credentials or provider payloads were printed.\n');
    process.exitCode = 1;
  } finally { db?.close(); }
}
