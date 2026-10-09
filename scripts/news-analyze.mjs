import { existsSync, readFileSync, statSync } from 'node:fs';
import { setImmediate } from 'node:timers';
import { parseArgs } from 'node:util';
import { openDatabase } from '../packages/storage/dist/index.js';
import { NewsIntelligenceService, saveNewsAnalysisConfiguration } from '../packages/services/dist/index.js';

const { values } = parseArgs({ options: { database: { type: 'string' }, configuration: { type: 'string' },
  incremental: { type: 'boolean', default: false }, 'install-mapping': { type: 'boolean', default: false }, 'input-cutoff-ms': { type: 'string' }, 'max-observations': { type: 'string' } } });
let database;
try {
  if (!values.database || !existsSync(values.database) || !statSync(values.database).isFile() ||
    !values.configuration || statSync(values.configuration).size > 64 * 1024) throw new Error();
  const configuration = JSON.parse(readFileSync(values.configuration, 'utf8'));
  database = openDatabase(values.database);
  const service = new NewsIntelligenceService({ database, clock: { nowMs: () => Date.now() } });
  if (values['install-mapping']) saveNewsAnalysisConfiguration(configuration, database);
  let step;
  if (values.incremental) {
    do { step = service.advance(configuration); if (step.state === 'processing') await new Promise(resolve => setImmediate(resolve)); } while (step.state === 'processing');
  }
  const result = step?.result ?? service.analyze(configuration, {
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
