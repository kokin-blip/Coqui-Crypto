import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDatabase } from '../packages/storage/dist/index.js';
import { NewsIntelligenceService } from '../packages/services/dist/index.js';

const { values } = parseArgs({ options: { database: { type: 'string' }, configuration: { type: 'string' },
  'input-cutoff-ms': { type: 'string' }, 'max-observations': { type: 'string' } } });
let database;
try {
  if (!values.database || !existsSync(values.database) || !statSync(values.database).isFile() ||
    !values.configuration || statSync(values.configuration).size > 64 * 1024) throw new Error();
  const configuration = JSON.parse(readFileSync(values.configuration, 'utf8'));
  database = openDatabase(values.database);
  const service = new NewsIntelligenceService({ database, clock: { nowMs: () => Date.now() } });
  const result = service.analyze(configuration, {
    ...(values['input-cutoff-ms'] ? { inputCutoffMs: Number(values['input-cutoff-ms']) } : {}),
    ...(values['max-observations'] ? { maxObservations: Number(values['max-observations']) } : {}),
  });
  console.log(JSON.stringify({ ok: true, inserted: result.inserted, runId: result.run.id,
    observations: result.analyses.length, groups: result.clusters.length,
    unresolvedCandidates: result.unresolvedCandidateCount,
    missingRegistryAssets: configuration.instruments.length - result.run.registry.length,
    availableAtMs: result.run.availableAtMs, networkRequests: 0 }));
} catch {
  console.error('News analysis failed. Supply --database EXISTING_DATABASE --configuration REVIEWED_JSON. Check schemas, registry, cutoff and input bound; no partial analysis is retained.');
  process.exitCode = 1;
} finally { database?.close(); }
