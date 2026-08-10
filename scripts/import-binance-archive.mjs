import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { join, resolve } from 'node:path';

import {
  createHttpClient,
  downloadBinanceMonthlyKlines,
} from '../packages/adapters/dist/index.js';
import { createOperationalMetrics } from '../packages/observability/dist/index.js';
import { persistBinanceDailyKlines } from '../packages/services/dist/index.js';
import {
  openDatabase,
  saveOperationalMetric,
} from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm archive:binance -- --symbol=BTCUSDT --year=2024 --month=12
      [--database=data/coqui.sqlite] [--archive-dir=data/archive/binance]

Downloads one Binance spot monthly 1d-kline archive, verifies its published
SHA-256, preserves the raw ZIP/checksum/manifest, and imports exact daily rows.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function writeImmutable(path, contents) {
  if (existsSync(path)) {
    const prior = readFileSync(path);
    const next = typeof contents === 'string' ? Buffer.from(contents) : Buffer.from(contents);
    if (!prior.equals(next)) throw new Error('An immutable archive artifact already differs.');
    return false;
  }
  writeFileSync(path, contents, { flag: 'wx' });
  return true;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const symbol = option('symbol') ?? '';
const year = Number(option('year'));
const month = Number(option('month'));
if (!symbol || !Number.isSafeInteger(year) || !Number.isSafeInteger(month)) {
  console.error(HELP);
  process.exit(2);
}

const databaseOption = option('database') ?? 'data/coqui.sqlite';
const databasePath = databaseOption === ':memory:' ? databaseOption : resolve(databaseOption);
const archiveRoot = resolve(option('archive-dir') ?? 'data/archive/binance');
const retrievedAtMs = Date.now();
const database = openDatabase(databasePath);
const http = createHttpClient();
const metrics = createOperationalMetrics({
  sink: (observation) => saveOperationalMetric(observation, database),
  labels: { component: 'binance_bulk_import', provider: 'binance' },
});
const stopTimer = metrics.startTimer('market_data_job_duration_ms', {
  operation: 'bulk_archive_import',
});

try {
  const result = await downloadBinanceMonthlyKlines(http, {
    symbol, year, month, retrievedAtMs,
  });
  if (!result.ok) {
    metrics.counter('market_data_job_outcomes_total', 1, {
      operation: 'bulk_archive_import', outcome: 'failure', reason: result.code,
    });
    stopTimer({ outcome: 'failure', reason: result.code });
    console.error(JSON.stringify({ ok: false, code: result.code, stage: result.stage,
      status: result.status }, null, 2));
    process.exitCode = 1;
  } else {
    const monthText = String(month).padStart(2, '0');
    const directory = join(archiveRoot, symbol, String(year), monthText);
    mkdirSync(directory, { recursive: true });
    const archiveName = `${symbol}-1d-${year}-${monthText}.zip`;
    const manifestText = `${JSON.stringify(result.manifest, null, 2)}\n`;
    writeImmutable(join(directory, archiveName), result.archiveBytes);
    writeImmutable(join(directory, `${archiveName}.CHECKSUM`), result.checksumText);
    const manifestPath = join(directory, `${archiveName}.manifest.json`);
    if (existsSync(manifestPath)) {
      const prior = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (prior.manifestHash !== result.manifest.manifestHash) {
        throw new Error('An immutable archive manifest already differs.');
      }
    } else {
      writeImmutable(manifestPath, manifestText);
    }
    persistBinanceDailyKlines(result.records, retrievedAtMs, database);
    metrics.gauge('market_data_cached_bars', result.records.length, {
      operation: 'bulk_archive_import', outcome: 'success',
    });
    metrics.counter('market_data_job_outcomes_total', 1, {
      operation: 'bulk_archive_import', outcome: 'success',
    });
    stopTimer({ outcome: 'success' });
    console.log(JSON.stringify({ ok: true, ...result.manifest, manifestPath,
      localArchivePath: join(directory, archiveName) }, null, 2));
  }
} catch {
  metrics.counter('market_data_job_outcomes_total', 1, {
    operation: 'bulk_archive_import', outcome: 'failure', reason: 'exception',
  });
  stopTimer({ outcome: 'failure', reason: 'exception' });
  console.error('Binance archive import failed without exposing remote payloads.');
  process.exitCode = 1;
} finally {
  http.destroy();
  database.close();
}
