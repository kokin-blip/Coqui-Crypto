import { resolve } from 'node:path';

import {
  createHttpClient,
  fetchCoinbaseDailyBars,
} from '../packages/adapters/dist/index.js';
import { syncCoinbaseDecisionDataset } from '../packages/services/dist/index.js';
import { createOperationalMetrics } from '../packages/observability/dist/index.js';
import {
  openDatabase,
  saveOperationalMetric,
} from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm dataset:coinbase -- --products=BTC-USD,ETH-USD [--days=365] [--min-days=300]
                           [--database=data/coqui.sqlite]

Builds a gap-free daily DecisionMarketDataset from completed Coinbase bars.
Only its compact provenance and SHA-256 hash are printed.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const productIds = (option('products') ?? '').split(',').map((value) => value.trim())
  .filter(Boolean);
if (productIds.length === 0) {
  console.error(HELP);
  process.exit(2);
}
const days = Number(option('days') ?? '365');
const minDays = Number(option('min-days') ?? String(Math.max(1, days - 2)));
if (!Number.isSafeInteger(days) || days <= 0 || !Number.isSafeInteger(minDays) || minDays <= 0) {
  console.error('days and min-days must be positive integers.');
  process.exit(2);
}
const databaseOption = option('database') ?? 'data/coqui.sqlite';
const databasePath = databaseOption === ':memory:' ? databaseOption : resolve(databaseOption);
const instruments = productIds.map((productId) => ({
  venue: 'coinbase', productId, productType: 'spot',
}));
const database = openDatabase(databasePath);
const http = createHttpClient();
const metrics = createOperationalMetrics({
  sink: (observation) => saveOperationalMetric(observation, database),
});

try {
  const result = await syncCoinbaseDecisionDataset({
    database,
    instruments,
    maxDays: days,
    minAlignedDays: minDays,
    nowMs: Date.now(),
    metrics,
    fetchDailyBars: (instrument, options) =>
      fetchCoinbaseDailyBars(http, instrument, options),
  });
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, code: result.code, message: result.message,
      failures: result.failures?.map((failure) => ({
        productId: failure.instrument.productId,
        status: failure.status,
        reason: failure.reason,
      })) ?? [] }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, products: result.dataset.assets,
      alignedDays: result.dataset.dayKeys.length, ...result.provenance }, null, 2));
  }
} catch {
  console.error('Dataset build failed without exposing credentials or remote payloads.');
  process.exitCode = 1;
} finally {
  http.destroy();
  database.close();
}
