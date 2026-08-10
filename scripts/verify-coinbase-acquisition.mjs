import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { verifyCoinbaseDailyArchiveArtifact } from '../packages/adapters/dist/index.js';

const HELP = `Usage:
  pnpm archive:verify-coinbase -- --manifest=path/to/manifest.json

Re-derives an immutable Coinbase acquisition's manifest, raw artifact, page,
and exact record hashes. Prints identifiers and counts only.`;

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const manifestOption = option('manifest') ?? '';
if (!manifestOption) {
  console.error(HELP);
  process.exit(2);
}

try {
  const manifestPath = resolve(manifestOption);
  if (!existsSync(manifestPath) || basename(manifestPath) !== 'manifest.json') {
    throw new Error('The Coinbase acquisition manifest does not exist.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.archivePath !== 'string' || basename(manifest.archivePath) !== manifest.archivePath) {
    throw new Error('The Coinbase raw artifact path is unsafe.');
  }
  const rawPath = join(dirname(manifestPath), manifest.archivePath);
  const records = verifyCoinbaseDailyArchiveArtifact(
    manifest, readFileSync(rawPath, 'utf8'),
  );
  console.log(JSON.stringify({
    ok: true,
    productId: manifest.productId,
    manifestHash: manifest.manifestHash,
    archiveSha256: manifest.archiveSha256,
    pageCount: manifest.pageCount,
    recordCount: records.length,
    firstStartTimeMs: manifest.firstStartTimeMs,
    lastStartTimeMs: manifest.lastStartTimeMs,
  }, null, 2));
} catch {
  console.error('Coinbase acquisition verification failed without exposing market contents.');
  process.exitCode = 1;
}
