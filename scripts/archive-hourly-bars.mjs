import { readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { writeMarketBarArchive, verifyMarketBarArchive } from '../packages/storage/dist/index.js';
import { join } from 'node:path';
const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, 'source-manifest': { type: 'string' }, 'code-revision': { type: 'string' } } });
try {
  if (!values.input || !values.output || !values['source-manifest'] || !values['code-revision'] || statSync(values.input).size > 64*1024*1024 || statSync(values['source-manifest']).size > 65536) throw new Error();
  const raw = readFileSync(values.input), records = JSON.parse(raw.toString('utf8')), source = JSON.parse(readFileSync(values['source-manifest'], 'utf8'));
  const rawContentHash = createHash('sha256').update(raw).digest('hex');
  if (!Array.isArray(records) || records.length > 100000 || records.some(r => r.interval !== '1h' || r.source !== 'coinbase' || r.instrument?.venue !== 'coinbase' || r.quality !== 'reported_ohlc' || !r.isComplete) || source.rawContentHash !== rawContentHash || source.interval !== '1h') throw new Error();
  const { manifestHash, ...sourceBody } = source;
  if (createHash('sha256').update(JSON.stringify(sourceBody)).digest('hex') !== manifestHash || typeof source.sourceId !== 'string') throw new Error();
  const manifest = await writeMarketBarArchive({ rootDir: values.output, records, sourceArtifacts: [{sourceId:source.sourceId,manifestHash,rawContentHash}], codeRevision: values['code-revision'], createdAtMs: Date.now() });
  await verifyMarketBarArchive(join(values.output,'datasets',manifest.datasetHash));
  console.log(JSON.stringify({datasetHash:manifest.datasetHash,manifestHash:manifest.manifestHash,records:manifest.recordCount,networkRequests:0}));
} catch { console.error('Hourly archive failed. Supply complete reported Coinbase hourly bars and their checksummed source manifest; daily interpolation is unsupported.');process.exitCode=1; }
