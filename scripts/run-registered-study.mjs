import { resolve } from 'node:path';

import { DEFAULT_TRADE_COST_CONFIG } from '../packages/core/dist/index.js';
import {
  requireResearchPreRegistration,
  runRegisteredNestedStudy,
} from '../packages/services/dist/index.js';
import {
  openDatabase,
  prepareDecisionDatasetFromArchives,
  verifiedResearchStudyRuns,
} from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm research:run-plan -- \\
    --plan-hash=<sha256> \\
    --archives=path/to/btc,path/to/eth,path/to/ltc \\
    [--database=data/research.sqlite] \\
    [--output-root=data/research-archive]

Reconstructs the exact registered dataset, opens the final holdout once, and
atomically records both the full trial budget and immutable result.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const planHash = option('plan-hash') ?? '';
const archiveOptions = (option('archives') ?? '').split(',').map((value) => value.trim())
  .filter(Boolean);
if (!/^[a-f0-9]{64}$/u.test(planHash) || archiveOptions.length === 0) {
  console.error(HELP);
  process.exit(2);
}
const databasePath = resolve(option('database') ?? 'data/research.sqlite');
const database = openDatabase(databasePath);

try {
  const plan = requireResearchPreRegistration(planHash, database);
  const instruments = plan.execution.baseTargets.map(({ assetId }) => {
    const [venue, productType, productId, ...extra] = assetId.split('|');
    if (venue !== 'coinbase' || productType !== 'spot' || !productId || extra.length > 0) {
      throw new TypeError('The registered runner accepts Coinbase spot targets only.');
    }
    return { venue, productType, productId };
  });
  const prepared = await prepareDecisionDatasetFromArchives({
    rootDir: resolve(option('output-root') ?? 'data/research-archive'),
    sourceDatasetDirs: archiveOptions.map((directory) => resolve(directory)),
    instruments,
    startTimeMs: plan.validation.development.startMs,
    endExclusiveMs: plan.validation.holdout.endExclusiveMs,
    codeRevision: plan.codeRevision,
  });
  const completedAtMs = Date.now();
  const result = runRegisteredNestedStudy({
    preRegistrationHash: planHash,
    dataset: prepared.dataset,
    tradeCosts: DEFAULT_TRADE_COST_CONFIG,
    codeRevision: plan.codeRevision,
    completedAtMs,
  }, database);
  const run = verifiedResearchStudyRuns(database).find(
    (item) => item.preRegistrationHash === planHash,
  );
  if (run === undefined) throw new Error('The immutable study run was not persisted.');
  const pboSummary = Object.fromEntries(
    Object.entries(result.pbo).filter(([key]) => key !== 'splits'),
  );
  console.log(JSON.stringify({
    ok: true,
    planId: result.planId,
    planHash,
    runHash: run.runHash,
    completedAtMs,
    datasetHash: result.datasetHash,
    candidateCount: result.candidateCount,
    selectedCandidate: result.selectedCandidate,
    pbo: pboSummary,
    holdout: result.holdout,
  }, null, 2));
} catch {
  console.error('Registered research execution failed without exposing market rows.');
  process.exitCode = 1;
} finally {
  database.close();
}
