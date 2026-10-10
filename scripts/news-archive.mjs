import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDatabase, writeNewsArchive } from '../packages/storage/dist/index.js';
const { values } = parseArgs({ options: { database: { type: 'string' }, output: { type: 'string' }, 'code-revision': { type: 'string' } } });
let database;
try {
  if (!values.database || !existsSync(values.database) || !values.output || !values['code-revision']) throw new Error('Existing database, output and code revision required.');
  database = openDatabase(values.database);
  const cutoffMs = Date.now();
  const manifest = await writeNewsArchive({ database, rootDir: values.output, cutoffMs, createdAtMs: Date.now(), codeRevision: values['code-revision'] });
  console.log(JSON.stringify({ manifestHash: manifest.manifestHash, datasetHash: manifest.datasetHash, records: manifest.recordCount, networkRequests: 0 }));
} catch { console.error('News archival failed. Check evidence eligibility, integrity and bounds. No metered retention is enabled.'); process.exitCode = 1; }
finally { database?.close(); }
