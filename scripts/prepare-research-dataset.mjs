import { resolve } from 'node:path';

import { prepareDecisionDatasetFromArchives } from '../packages/storage/dist/index.js';

const HELP = `Usage:
  pnpm research:prepare-dataset -- \\
    --archives=path/to/archive-a,path/to/archive-b \\
    --products=BTC-USD,ETH-USD \\
    --start=2020-01-01 \\
    --end-exclusive=2024-01-01 \\
    --code-revision=<git-commit-or-build-id> \\
    [--output-root=data/research-archive]

Verifies immutable Coinbase Parquet archives and prepares one exact, gap-free,
content-addressed decision-dataset manifest. No provider credentials are used.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function listOption(name) {
  const raw = option(name) ?? '';
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new TypeError(`--${name} must contain unique comma-separated values.`);
  }
  return values;
}

function utcDate(name) {
  const raw = option(name) ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new TypeError(`--${name} must use YYYY-MM-DD.`);
  }
  const value = Date.parse(`${raw}T00:00:00.000Z`);
  if (!Number.isSafeInteger(value) || new Date(value).toISOString().slice(0, 10) !== raw) {
    throw new TypeError(`--${name} must be a real UTC calendar date.`);
  }
  return value;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

try {
  const archives = listOption('archives').map((path) => resolve(path));
  const products = listOption('products');
  const codeRevision = option('code-revision') ?? '';
  if (!codeRevision) throw new TypeError('--code-revision is required.');
  const prepared = await prepareDecisionDatasetFromArchives({
    rootDir: resolve(option('output-root') ?? 'data/research-archive'),
    sourceDatasetDirs: archives,
    instruments: products.map((productId) => ({
      venue: 'coinbase',
      productId,
      productType: 'spot',
    })),
    startTimeMs: utcDate('start'),
    endExclusiveMs: utcDate('end-exclusive'),
    codeRevision,
  });
  console.log(JSON.stringify({
    ok: true,
    directory: prepared.directory,
    manifestHash: prepared.manifest.manifestHash,
    decisionDatasetHash: prepared.manifest.decisionDatasetHash,
    sourceDatasetHashes: prepared.manifest.sourceArchives.map((source) => source.datasetHash),
    products: prepared.manifest.instruments.map((instrument) => instrument.productId),
    startTimeMs: prepared.manifest.startTimeMs,
    endExclusiveMs: prepared.manifest.endExclusiveMs,
    alignedDayCount: prepared.manifest.alignedDayCount,
  }, null, 2));
} catch {
  console.error('Research-dataset preparation failed without exposing archive contents.');
  console.error(HELP);
  process.exitCode = 1;
}
