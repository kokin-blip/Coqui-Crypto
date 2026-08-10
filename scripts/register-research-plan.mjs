import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { registerResearchPreRegistration } from '../packages/services/dist/index.js';
import { openDatabase } from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm research:register-plan -- --plan=path/to/plan.json [--database=data/coqui.sqlite]

Validates and immutably records a research plan before any candidate or holdout
result is opened. The plan must contain exact dataset, cost-profile, code,
parameter-grid, chronological-window, benchmark, and adoption declarations.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const planOption = option('plan') ?? '';
if (!planOption) {
  console.error(HELP);
  process.exit(2);
}
const planPath = resolve(planOption);
if (!existsSync(planPath)) {
  console.error('The research plan file does not exist.');
  process.exit(2);
}

const databaseOption = option('database') ?? 'data/coqui.sqlite';
const databasePath = databaseOption === ':memory:' ? databaseOption : resolve(databaseOption);
const database = openDatabase(databasePath);

try {
  const plan = JSON.parse(readFileSync(planPath, 'utf8'));
  const planHash = registerResearchPreRegistration(plan, database);
  console.log(JSON.stringify({
    ok: true,
    id: plan.id,
    candidateCount: plan.candidateCount,
    planHash,
  }, null, 2));
} catch {
  console.error('Research-plan registration failed without exposing plan contents.');
  process.exitCode = 1;
} finally {
  database.close();
}
