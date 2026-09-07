import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SystemClock } from '../packages/core/dist/index.js';
import { MarketEventService, parseLocalMarketEventFixture } from '../packages/services/dist/index.js';
import { openDatabase } from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm events:import-local -- --file=events.json --source=local-feed [--profile=main] [--database=data/coqui.sqlite]

Imports a bounded local JSON array into the immutable market-event dataset.
Each item must include sourceEventId, title, publishedAtMs, and firstSeenAtMs.
This command never connects to an event provider and cannot affect targets or execution.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const fileOption = option('file') ?? '', sourceId = option('source') ?? '';
if (!fileOption || !sourceId) {
  console.error(HELP);
  process.exit(2);
}
const fixturePath = resolve(fileOption);
if (!existsSync(fixturePath)) {
  console.error('The local event fixture does not exist.');
  process.exit(2);
}

const databaseOption = option('database') ?? 'data/coqui.sqlite';
const databasePath = databaseOption === ':memory:' ? databaseOption : resolve(databaseOption);
const database = openDatabase(databasePath);
try {
  const events = parseLocalMarketEventFixture(readFileSync(fixturePath, 'utf8'));
  const results = new MarketEventService({ profileId: option('profile') ?? 'main', database,
    clock: new SystemClock(() => Date.now()) }).ingestLocal(sourceId, fixturePath, events);
  console.log(JSON.stringify({ ok: true, imported: results.filter((item) => item.inserted).length,
    existing: results.filter((item) => !item.inserted).length, targetInfluence: false,
    executionAuthority: false }, null, 2));
} catch {
  console.error('Market-event import failed without exposing fixture contents.');
  process.exitCode = 1;
} finally {
  database.close();
}
