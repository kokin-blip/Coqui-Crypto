import { URL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { replayExecutionPolicies } from '../packages/core/dist/research/execution-replay.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/replay-paper-execution.mjs /path/to/coqui.db');
const plan = readFileSync(new URL('../docs/studies/execution-policy-v1.json', import.meta.url), 'utf8');
const registry = JSON.parse(plan);
const db = new DatabaseSync(path, { readOnly: true });
try {
  const experiment = db.prepare('SELECT id FROM parallel_paper_experiments_v1 ORDER BY started_at DESC LIMIT 1').get();
  const rows = experiment ? db.prepare(`SELECT detail_json FROM parallel_paper_events_v1
    WHERE experiment_id=? AND kind='execution_observation' ORDER BY rowid`).all(experiment.id)
    .map((row) => JSON.parse(row.detail_json)) : [];
  // The holdout is deliberately inaccessible from this development runner.
  const development = rows.filter((row) => Date.parse(`${row.slot}:00:00Z`) >= Date.parse(registry.developmentStart) && Date.parse(`${row.slot}:00:00Z`) < Date.parse(registry.holdoutStart));
  const folds = registry.foldBoundaries.slice(1).map((end, index) => {
    const start = registry.foldBoundaries[index];
    const tape = development.filter((row) => Date.parse(`${row.slot}:00:00Z`) >= Date.parse(start) && Date.parse(`${row.slot}:00:00Z`) < Date.parse(end));
    const expected = (Date.parse(end) - Date.parse(start)) / (4 * 3_600_000);
    return { start, end, expectedSlots: expected, observedSlots: tape.length,
      result: tape.length !== expected ? { status: 'incomplete_fold', results: [] } : replayExecutionPolicies(tape),
      stress: tape.length !== expected ? null : replayExecutionPolicies(tape, 100_000, 2) };
  });
  console.log(JSON.stringify({ planHash: createHash('sha256').update(plan).digest('hex'),
    datasetHash: createHash('sha256').update(JSON.stringify(development)).digest('hex'),
    holdout: 'sealed_not_evaluated', collectedSlots: rows.length, folds,
    candidateIds: registry.candidateIds,
    limitations: ['Modeled fills; no queue or depth evidence. Missed fills unknown.',
      'No policy changes authorized by this report.', 'Synthetic tests are not market evidence.'] }, null, 2));
} finally { db.close(); }
