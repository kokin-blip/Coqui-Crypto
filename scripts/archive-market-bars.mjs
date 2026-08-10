import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import {
  listMarketBars,
  openDatabase,
  verifyMarketBarArchive,
  writeMarketBarArchive,
} from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm archive:parquet -- --venue=kraken --product=XBTUSD --source=kraken
      --source-manifest=data/archive/kraken/.../Kraken_OHLCVT.zip.manifest.json
      --code-revision=<git-commit-or-explicit-working-tree-label>
      [--database=data/coqui.sqlite] [--archive-dir=data/research-archive]

Exports one cached daily spot instrument into an immutable, year-partitioned
Parquet dataset, binds it to its raw-source manifest and code revision, then
verifies all hashes and rows through DuckDB before reporting success.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function sourceArtifact(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof value !== 'object' || value === null ||
      typeof value.manifestHash !== 'string' || typeof value.archiveSha256 !== 'string') {
    throw new TypeError('The source manifest lacks required manifest/archive hashes.');
  }
  const identity = typeof value.archivePath === 'string' ? value.archivePath
    : typeof value.archiveName === 'string' ? value.archiveName : basename(path);
  const provider = typeof value.source === 'string' ? value.source : 'unknown';
  return {
    sourceId: `${provider}:${identity}`,
    manifestHash: value.manifestHash,
    rawContentHash: value.archiveSha256,
  };
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const venue = option('venue') ?? '';
const productId = option('product') ?? '';
const source = option('source') ?? '';
const sourceManifestOption = option('source-manifest') ?? '';
const codeRevision = option('code-revision') ?? '';
if (!venue || !productId || !source || !sourceManifestOption || !codeRevision) {
  console.error(HELP);
  process.exit(2);
}
const sourceManifestPath = resolve(sourceManifestOption);
if (!existsSync(sourceManifestPath)) {
  console.error('The source manifest does not exist.');
  process.exit(2);
}

const databaseOption = option('database') ?? 'data/coqui.sqlite';
const databasePath = databaseOption === ':memory:' ? databaseOption : resolve(databaseOption);
const archiveRoot = resolve(option('archive-dir') ?? 'data/research-archive');
const database = openDatabase(databasePath);

try {
  const records = listMarketBars({ venue, productId, productType: 'spot' }, database, source);
  if (records.length === 0) throw new Error('No matching cached market bars were found.');
  const manifest = await writeMarketBarArchive({
    rootDir: archiveRoot,
    records,
    sourceArtifacts: [sourceArtifact(sourceManifestPath)],
    codeRevision,
    createdAtMs: Date.now(),
  });
  const datasetDir = resolve(archiveRoot, 'datasets', manifest.datasetHash);
  await verifyMarketBarArchive(datasetDir);
  console.log(JSON.stringify({ ok: true, datasetDir, ...manifest }, null, 2));
} catch {
  console.error('Market-bar archive export failed without exposing source contents.');
  process.exitCode = 1;
} finally {
  database.close();
}
