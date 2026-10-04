import { readFileSync } from 'node:fs';
import { createHttpClient } from '../packages/adapters/dist/index.js';
import { parseMarketAcquisitionConfig, runMarketAcquisition } from '../packages/services/dist/index.js';

const HELP = `Usage:
  pnpm archive:market -- --config=config/market-acquisition.json --code-revision=<revision>
      [--refresh]

Acquires configured daily spot history into immutable raw and Parquet archives,
verifies it through DuckDB, and writes JSON/Markdown coverage reports. Resumes
verified local acquisitions by default; --refresh preserves upstream corrections
as new versions. No operational SQLite cache or credentials are used.`;
function option(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP); process.exit(0);
}
const file = option('config');
const codeRevision = option('code-revision');
if (!file || !codeRevision) { console.error(HELP); process.exit(2); }
const retrievedAtMs = Date.now();
const input = JSON.parse(readFileSync(file, 'utf8'));
if (process.argv.includes('--refresh')) input.refresh = true;
const config = parseMarketAcquisitionConfig(input, retrievedAtMs);
const controller = new globalThis.AbortController();
const http = createHttpClient({ maxElapsedMs: 24 * 60 * 60_000 });
const cancel = () => { controller.abort(); http.destroy(); };
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
try {
  const result = await runMarketAcquisition({ config, codeRevision, retrievedAtMs,
    http, signal: controller.signal, progress: (message) => console.error(message) });
  console.log(JSON.stringify({ ok: result.report.ok, reportDirectory: result.directory,
    reportHash: result.report.reportHash,
    instruments: result.report.instruments.map(({ product, status, datasetHash, failure, coverage }) => ({
      instrument: product.instrument, status, datasetHash, failure, rowCount: coverage.observedDayCount,
    })) }, null, 2));
  if (!result.report.ok) process.exitCode = 1;
} finally {
  http.destroy(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
}
