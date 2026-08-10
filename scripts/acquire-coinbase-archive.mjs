import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import {
  createHttpClient,
  downloadCoinbaseDailyArchive,
  verifyCoinbaseDailyArchiveArtifact,
} from '../packages/adapters/dist/index.js';
import {
  deepestCommonContinuousCoverage,
  prepareDecisionDatasetFromArchives,
  verifyMarketBarArchive,
  writeMarketBarArchive,
} from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm archive:coinbase -- \\
    --products=BTC-USD,ETH-USD,LTC-USD \\
    --start=2012-01-01 \\
    --end-exclusive=2026-08-09 \\
    --code-revision=<git-commit-or-explicit-build-id> \\
    [--source-dir=data/archive/coinbase] \\
    [--archive-dir=data/research-archive]

Downloads exact raw Coinbase Exchange daily-candle pages, preserves immutable
source artifacts, writes and verifies one N7 Parquet archive per product, then
prepares the longest shared gap-free multi-asset decision dataset. No key is used.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function utcDate(name) {
  const raw = option(name) ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new TypeError(`--${name} must use YYYY-MM-DD.`);
  const value = Date.parse(`${raw}T00:00:00.000Z`);
  if (!Number.isSafeInteger(value) || new Date(value).toISOString().slice(0, 10) !== raw) {
    throw new TypeError(`--${name} must be a real UTC calendar date.`);
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function preserveAcquisition(root, result) {
  const { manifest, rawArtifactText } = result;
  const parent = join(root, manifest.productId);
  const destination = join(parent, manifest.manifestHash);
  const rawPath = join(destination, manifest.archivePath);
  const manifestPath = join(destination, 'manifest.json');
  if (existsSync(destination)) {
    const raw = readFileSync(rawPath, 'utf8');
    const prior = JSON.parse(readFileSync(manifestPath, 'utf8'));
    verifyCoinbaseDailyArchiveArtifact(prior, raw);
    if (sha256(raw) !== manifest.archiveSha256 || prior.manifestHash !== manifest.manifestHash) {
      throw new Error('An immutable Coinbase acquisition artifact failed verification.');
    }
    return { rawPath, manifestPath };
  }
  mkdirSync(parent, { recursive: true });
  const temporary = join(parent, `.${manifest.manifestHash}.${randomUUID()}`);
  mkdirSync(temporary, { recursive: false });
  try {
    writeFileSync(join(temporary, manifest.archivePath), rawArtifactText, { flag: 'wx' });
    writeFileSync(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    renameSync(temporary, destination);
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: false });
    throw error;
  }
  verifyCoinbaseDailyArchiveArtifact(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
    readFileSync(rawPath, 'utf8'),
  );
  return { rawPath, manifestPath };
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const products = (option('products') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const codeRevision = option('code-revision') ?? '';
if (products.length === 0 || new Set(products).size !== products.length || !codeRevision) {
  console.error(HELP);
  process.exit(2);
}

const startTimeMs = utcDate('start');
const endExclusiveMs = utcDate('end-exclusive');
const retrievedAtMs = Date.now();
const sourceRoot = resolve(option('source-dir') ?? 'data/archive/coinbase');
const archiveRoot = resolve(option('archive-dir') ?? 'data/research-archive');
const instruments = products.map((productId) => ({
  venue: 'coinbase', productId, productType: 'spot',
}));
const http = createHttpClient();

try {
  const acquisitions = [];
  for (const instrument of instruments) {
    const result = await downloadCoinbaseDailyArchive(http, {
      instrument, startTimeMs, endExclusiveMs, retrievedAtMs,
    });
    if (!result.ok) throw new Error(`Coinbase acquisition failed: ${result.code}:${result.status}`);
    acquisitions.push(result);
  }

  const sourceManifests = [];
  const sourceDatasetDirs = [];
  for (const acquisition of acquisitions) {
    const paths = preserveAcquisition(sourceRoot, acquisition);
    sourceManifests.push({
      productId: acquisition.manifest.productId,
      manifestHash: acquisition.manifest.manifestHash,
      manifestPath: paths.manifestPath,
      recordCount: acquisition.manifest.recordCount,
    });
    const records = acquisition.records.map((record) => ({
      source: 'coinbase',
      instrument: record.instrument,
      providerAssetId: record.instrument.productId,
      interval: '1d',
      startTimeMs: record.startTimeMs,
      endTimeMs: record.endTimeMs,
      open: record.open,
      high: record.high,
      low: record.low,
      close: record.close,
      volume: record.volume,
      isComplete: record.isComplete,
      quality: 'reported_ohlc',
      retrievedAtMs,
    }));
    const archive = await writeMarketBarArchive({
      rootDir: archiveRoot,
      records,
      sourceArtifacts: [{
        sourceId: `coinbase-exchange-rest:${acquisition.manifest.productId}:` +
          `${startTimeMs}:${endExclusiveMs}`,
        manifestHash: acquisition.manifest.manifestHash,
        rawContentHash: acquisition.manifest.archiveSha256,
      }],
      codeRevision,
      createdAtMs: retrievedAtMs,
    });
    const datasetDir = join(archiveRoot, 'datasets', archive.datasetHash);
    await verifyMarketBarArchive(datasetDir);
    sourceDatasetDirs.push(datasetDir);
  }

  const coverage = deepestCommonContinuousCoverage(
    acquisitions.map((acquisition) => acquisition.records.map((record) => record.startTimeMs)),
  );
  if (coverage === null) throw new Error('The requested products have no shared daily coverage.');
  const prepared = await prepareDecisionDatasetFromArchives({
    rootDir: archiveRoot,
    sourceDatasetDirs,
    instruments,
    startTimeMs: coverage.startTimeMs,
    endExclusiveMs: coverage.endExclusiveMs,
    codeRevision,
  });
  console.log(JSON.stringify({
    ok: true,
    products,
    requestedStartTimeMs: startTimeMs,
    requestedEndExclusiveMs: endExclusiveMs,
    sourceManifests,
    sourceDatasetDirs,
    commonCoverage: coverage,
    preparedDirectory: prepared.directory,
    preparedManifestHash: prepared.manifest.manifestHash,
    decisionDatasetHash: prepared.manifest.decisionDatasetHash,
  }, null, 2));
} catch {
  console.error('Coinbase archive acquisition failed without exposing remote or market payloads.');
  process.exitCode = 1;
} finally {
  http.destroy();
}
