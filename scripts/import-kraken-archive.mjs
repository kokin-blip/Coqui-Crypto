import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { createKrakenDailyArchiveImporter } from '../packages/adapters/dist/index.js';
import { createOperationalMetrics } from '../packages/observability/dist/index.js';
import { persistKrakenDailyKlines } from '../packages/services/dist/index.js';
import { openDatabase, saveOperationalMetric } from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm archive:kraken -- --file=C:\\Downloads\\Kraken_OHLCVT.zip --pair=XBTUSD
      [--origin=complete|quarterly] [--database=data/coqui.sqlite]
      [--archive-dir=data/archive/kraken]

Streams one official Kraken OHLCVT ZIP, selects the explicit 1440-minute pair
CSV, preserves the source ZIP and manifest under its content hash, and imports
exact daily rows. Kraken does not publish a checksum for this archive.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function preserveArchive(sourcePath, destinationPath, expectedHash) {
  if (resolve(sourcePath) === resolve(destinationPath)) return false;
  if (existsSync(destinationPath)) {
    if (await sha256File(destinationPath) !== expectedHash) {
      throw new Error('A content-addressed Kraken archive artifact already differs.');
    }
    return false;
  }
  copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  if (await sha256File(destinationPath) !== expectedHash) {
    throw new Error('The preserved Kraken archive failed its local hash verification.');
  }
  return true;
}

function preserveManifest(path, manifest) {
  if (existsSync(path)) {
    const prior = JSON.parse(readFileSync(path, 'utf8'));
    if (prior.manifestHash !== manifest.manifestHash) {
      throw new Error('An immutable Kraken archive manifest already differs.');
    }
    return false;
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return true;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const fileOption = option('file') ?? '';
const pair = option('pair') ?? '';
const origin = option('origin') ?? 'complete';
if (!fileOption || !pair || (origin !== 'complete' && origin !== 'quarterly')) {
  console.error(HELP);
  process.exit(2);
}

const sourcePath = resolve(fileOption);
if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
  console.error('The Kraken archive file does not exist or is not a regular file.');
  process.exit(2);
}
const archiveName = basename(sourcePath);
const databaseOption = option('database') ?? 'data/coqui.sqlite';
const databasePath = databaseOption === ':memory:' ? databaseOption : resolve(databaseOption);
const archiveRoot = resolve(option('archive-dir') ?? 'data/archive/kraken');
const retrievedAtMs = Date.now();
const database = openDatabase(databasePath);
const metrics = createOperationalMetrics({
  sink: (observation) => saveOperationalMetric(observation, database),
  labels: { component: 'kraken_bulk_import', provider: 'kraken' },
});
const stopTimer = metrics.startTimer('market_data_job_duration_ms', {
  operation: 'bulk_archive_import',
});

try {
  const importer = createKrakenDailyArchiveImporter({
    pair, archiveName, origin, retrievedAtMs,
  });
  for await (const chunk of createReadStream(sourcePath)) importer.push(chunk);
  importer.push(new Uint8Array(), true);
  const result = importer.finish();
  if (!result.ok) {
    metrics.counter('market_data_job_outcomes_total', 1, {
      operation: 'bulk_archive_import', outcome: 'failure', reason: result.code,
    });
    stopTimer({ outcome: 'failure', reason: result.code });
    console.error(JSON.stringify({ ok: false, code: result.code, stage: result.stage }, null, 2));
    process.exitCode = 1;
  } else {
    const directory = join(archiveRoot, pair, result.manifest.archiveSha256);
    mkdirSync(directory, { recursive: true });
    const localArchivePath = join(directory, archiveName);
    await preserveArchive(sourcePath, localArchivePath, result.manifest.archiveSha256);
    const manifestPath = join(directory, `${archiveName}.manifest.json`);
    preserveManifest(manifestPath, result.manifest);
    persistKrakenDailyKlines(result.records, retrievedAtMs, database);
    metrics.gauge('market_data_cached_bars', result.records.length, {
      operation: 'bulk_archive_import', outcome: 'success',
    });
    metrics.counter('market_data_job_outcomes_total', 1, {
      operation: 'bulk_archive_import', outcome: 'success',
    });
    stopTimer({ outcome: 'success' });
    console.log(JSON.stringify({
      ok: true, ...result.manifest, manifestPath, localArchivePath,
    }, null, 2));
  }
} catch {
  metrics.counter('market_data_job_outcomes_total', 1, {
    operation: 'bulk_archive_import', outcome: 'failure', reason: 'exception',
  });
  stopTimer({ outcome: 'failure', reason: 'exception' });
  console.error('Kraken archive import failed without exposing archive contents.');
  process.exitCode = 1;
} finally {
  database.close();
}
