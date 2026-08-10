import { resolve } from 'node:path';

import {
  createHttpClient,
  fetchCoinbaseUniverseProducts,
} from '../packages/adapters/dist/index.js';
import {
  captureCoinbaseUniverseSnapshot,
} from '../packages/services/dist/index.js';
import { createOperationalMetrics } from '../packages/observability/dist/index.js';
import {
  openDatabase,
  saveOperationalMetric,
} from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm universe:snapshot -- [--database=data/coqui.sqlite]

Captures the full public Coinbase USD product universe. The observation becomes
eligible for strict daily research on the following UTC day.`;

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
const http = createHttpClient();
const metrics = createOperationalMetrics({
  sink: (observation) => saveOperationalMetric(observation, database),
});

try {
  const result = await captureCoinbaseUniverseSnapshot({
    database,
    observedAtMs: Date.now(),
    metrics,
    fetchProducts: () => fetchCoinbaseUniverseProducts(http),
  });
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, code: result.code, status: result.status,
      reason: result.reason, message: result.message }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      ok: true,
      created: result.created,
      snapshotId: result.snapshot.id,
      snapshotHash: result.snapshot.snapshotHash,
      observedAtMs: result.snapshot.observedAtMs,
      effectiveFromDayKey: result.snapshot.effectiveFromDayKey,
      productCount: result.snapshot.products.length,
    }, null, 2));
  }
} catch {
  console.error('Universe snapshot failed without exposing remote payloads.');
  process.exitCode = 1;
} finally {
  http.destroy();
  database.close();
}
