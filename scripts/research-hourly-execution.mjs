import { registeredStudyForReport } from '../packages/services/dist/research/registered-study.js';
import { listStudyInstances } from '../packages/storage/dist/repositories/study-instances.js';
import { DatabaseSync } from 'node:sqlite';
import { listHourlyExecutionRecords } from '../packages/storage/dist/repositories/hourly-execution.js';
import { replayHourlyExecution } from '../packages/core/dist/research/hourly-execution.js';

import { hourlyExecutionSourceHash } from '../packages/services/dist/paper/parallel-hourly-shadow.js';
import { studySourceMatches } from '../packages/core/dist/research/study-instance.js';

const dbPath = process.argv[2];
const holdout = process.argv.includes('--holdout');
if (!dbPath) throw new Error('Usage: node scripts/research-hourly-execution.mjs /path/to/coqui.db [--holdout]');
const db = new DatabaseSync(dbPath, { readOnly: true });
const DAY_MS = 86_400_000;
try {
  const profileId = process.argv.find((arg)=>arg.startsWith('--profile='))?.slice(10) ?? db.prepare('SELECT profile_id FROM hourly_execution_records_v1 WHERE kind=? ORDER BY at_ms LIMIT 1')
    .get('study')?.profile_id;
  if (!profileId) { console.log(JSON.stringify({ status: 'not_registered', results: [] }, null, 2)); process.exit(0); }
  const registered=registeredStudyForReport({profileId,candidateId:'trendvol-hourly-execution-v1',db,legacyHash:hourlyExecutionSourceHash(),legacyList:(kind,cutoff)=>listHourlyExecutionRecords(profileId,kind,db,cutoff)});
  const studyRecord = listHourlyExecutionRecords(profileId, 'study', db).at(-1) ?? listStudyInstances(profileId,'trendvol-hourly-execution-v1',db).at(-1);
  const study = registered.study;
  if (!studySourceMatches(study.sourceHash, registered.sourceHash)) {
    console.log(JSON.stringify({status:'source_changed',candidate:study.version,results:[],holdout:'sealed_not_read'},null,2));
    process.exit(0);
  }
  if (holdout && Date.now() < study.holdoutEndMs) throw new Error('holdout_sealed_until_end');
  const cutoff = holdout ? study.holdoutEndMs : study.foldEndsMs[2];
  const rows = registered.records('observation',cutoff)
    .map((record) => ({ slotMs: record.body.observation.slotMs, ...record.body }));
  const windows = holdout ? [{ start: study.foldEndsMs[2], end: study.holdoutEndMs, name: 'holdout' }]
    : [0, 1, 2].map((index) => ({ start: index === 0 ? study.startMs : study.foldEndsMs[index - 1],
      end: study.foldEndsMs[index], name: `development-${index + 1}` }));
  const report = windows.map(({ start, end, name }) => {
    const selected = rows.filter((row) => row.slotMs >= start && row.slotMs < end);
    const expectedDays = (end - start) / DAY_MS;
    const hours = new Map();
    for (const row of selected) {
      const day = Math.floor(row.slotMs / DAY_MS) * DAY_MS;
      const set = hours.get(day) ?? new Set(); set.add(new Date(row.slotMs).getUTCHours()); hours.set(day, set);
    }
    const completeDays = [...hours.values()].filter((set) => set.size === 24).length;
    const unavailableDays = Array.from({ length: expectedDays }, (_, index) => start + index * DAY_MS)
      .filter((day) => (hours.get(day)?.size ?? 0) !== 24)
      .map((day) => new Date(day).toISOString().slice(0, 10));
    const coverage = { expectedDays, completeDays, unavailableDays: expectedDays - completeDays,
      unavailableDayKeys: unavailableDays, observedHours: selected.length, expectedHours: expectedDays * 24 };
    if (completeDays !== expectedDays || selected.length !== expectedDays * 24 ||
        selected[0]?.slotMs !== start || selected[0]?.opening == null) {
      return { name, start, end, status: 'incomplete_coverage', coverage, base: null, doubledFriction: null };
    }
    const tape = selected.map((row) => row.observation);
    const base = replayHourlyExecution(tape, selected[0].opening);
    const doubledFriction = replayHourlyExecution(tape, selected[0].opening, 2);
    return { name, start, end, status: base.status, coverage, base, doubledFriction };
  });
  const partials = db.prepare(`SELECT detail_json FROM parallel_paper_events_v1
    WHERE profile_id=? AND kind='external_order' AND at>=? AND at<?`).all(profileId,
      holdout ? study.foldEndsMs[2] : study.startMs, cutoff)
    .map((row) => JSON.parse(row.detail_json))
    .filter((detail) => detail.status === 'partially_filled');
  console.log(JSON.stringify({ candidate: study.version, registrationHash: studyRecord.hash ?? studyRecord.id, studyInstanceId: registered.studyInstanceId,
    planHash: study.planHash, sourceHash: study.sourceHash,
    status: 'shadow_only', holdout: holdout ? 'explicitly_opened_after_end' : 'sealed_not_read',
    observedAlpacaPartialOrderIds: [...new Set(partials.map((item) => item.orderId))].length,
    results: report, limitations: ['Modeled market fills are immediate; candidate partial fills are unknown.',
      'Missing hourly days are unavailable, never backfilled.',
      'No research result authorizes an Alpaca paper-order policy change.'] }, null, 2));
} finally { db.close(); }
