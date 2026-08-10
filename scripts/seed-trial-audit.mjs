import { resolve } from 'node:path';

import {
  registeredTrialCount,
  totalRegisteredTrialCount,
} from '../packages/core/dist/index.js';
import { seedPredecessorTrialAudit } from '../packages/services/dist/index.js';
import { loadTrialRegistry, openDatabase } from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm research:seed-trials -- [--database=data/coqui.sqlite]

Idempotently records the code-visible predecessor search lower bound. This does
not mark the historical audit complete and therefore does not enable DSR.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const databaseOption = option('database') ?? 'data/coqui.sqlite';
const databasePath = databaseOption === ':memory:' ? databaseOption : resolve(databaseOption);
const database = openDatabase(databasePath);

try {
  const inserted = seedPredecessorTrialAudit(database);
  const registry = loadTrialRegistry(database);
  console.log(JSON.stringify({
    ok: true,
    inserted,
    completeness: registry.completeness,
    knownTrialCount: totalRegisteredTrialCount(registry),
    byFamily: {
      momentum: registeredTrialCount(registry, 'momentum'),
      voltarget: registeredTrialCount(registry, 'voltarget'),
      trendvol: registeredTrialCount(registry, 'trendvol'),
      rotation: registeredTrialCount(registry, 'rotation'),
    },
    significanceEnabled: false,
  }, null, 2));
} catch {
  console.error('Trial-audit seeding failed without exposing research payloads.');
  process.exitCode = 1;
} finally {
  database.close();
}
