import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DEFAULT_VENUE_COST_PROFILE, instrumentKey, newsEvidenceHash, runNewsStudy } from '../packages/core/dist/index.js';
import { newsFeatureSnapshotSchema } from '../packages/contracts/dist/index.js';
import { openDatabase, readNewsArchive, queryMarketBarArchive, verifyMarketBarArchive, setSetting } from '../packages/storage/dist/index.js';
const { values } = parseArgs({ options: { 'news-archive': { type: 'string', multiple: true }, 'market-archive': { type: 'string', multiple: true },
  output: { type: 'string' }, database: { type: 'string' }, 'code-revision': { type: 'string' } } });
let database;
try {
  if (!values.output || !values['code-revision'] || !values['news-archive']?.length && !values.database) throw new Error('Verified news and market archives required.');
  if (values.database && !existsSync(values.database)) throw new Error('An existing database is required.');
  const hashes = [], bars = [], features = [];
  let inputDiagnostics = null;
  if (!values['news-archive']?.length) {
    database = openDatabase(values.database);
    const observations = database.prepare('SELECT count(*) AS n FROM news_observations_v1').get().n;
    if (observations !== 0) throw new Error('Retained evidence must be exported and verified before evaluation.');
    inputDiagnostics = { kind: 'empty_operational_snapshot', schemaVersion: database.prepare('PRAGMA user_version').get().user_version,
      observationCount: observations, requiredRegistry: database.prepare("SELECT venue,product_id,product_type FROM canonical_instruments WHERE venue='coinbase' AND product_id IN ('BTC-USD','ETH-USD','SOL-USD') ORDER BY product_id").all() };
    hashes.push(newsEvidenceHash(inputDiagnostics));
    database.close(); database = undefined;
  }
  for (const directory of values['news-archive'] ?? []) {
    const archive = await readNewsArchive(directory); hashes.push(archive.manifest.manifestHash);
    for (const row of archive.records) if (row.kind === 'feature') features.push(newsFeatureSnapshotSchema.parse(row.payload));
    if (features.length > 100000) throw new Error('Feature input exceeds bound.');
  }
  for (const directory of values['market-archive'] ?? []) {
    const manifest = await verifyMarketBarArchive(directory); hashes.push(manifest.manifestHash);
    for (const b of await queryMarketBarArchive(directory)) {
      if (!b.isComplete || b.quality !== 'reported_ohlc' || b.venue !== 'coinbase') continue;
      bars.push({ instrumentKey: instrumentKey({ venue: 'coinbase', productType: b.productType, productId: b.productId }), interval: b.interval,
        startTimeMs: b.startTimeMs, endTimeMs: b.endTimeMs, open: Number(b.open), close: Number(b.close),
        availableAtMs: Math.max(b.retrievedAtMs, b.endTimeMs + 300000) });
    }
    if (bars.length > 100000) throw new Error('Market input exceeds bound.');
  }
  const uniqueFeatures = [...new Map(features.map(f => [f.id, f])).values()];
  if (new Set(uniqueFeatures.map(f => f.featureVersion)).size > 1) throw new Error('Select one feature version for a frozen study.');
  const profile = DEFAULT_VENUE_COST_PROFILE;
  const cost = { feeBps: profile.takerFeeBps, spreadBps: profile.spreadBps, slippageBps: profile.slippageBps, minUsefulTradeUsd: profile.minUsefulTradeUsd, modelVersion: 'news-conservative-taker-v1', impactCoefBps: 0, impactRefUsd: 25000 };
  const completedAtMs = Date.now();
  const reports = [['daily', 24], ['hourly', 1], ['hourly', 4], ['hourly', 24]].map(([cadence, horizonHours]) => runNewsStudy({
    bars, features: uniqueFeatures, cadence, horizonHours, cost, sourceManifestHashes: hashes, codeRevision: values['code-revision'], completedAtMs }));
  const body = { version: 'news-study-report-v1', completedAtMs, inputDiagnostics, reports }, reportHash = newsEvidenceHash(body);
  const parent = resolve(values.output), destination = join(parent, reportHash), temporary = join(parent, `.${reportHash}.${randomUUID()}`);
  mkdirSync(parent, { recursive: true });
  if (!existsSync(destination)) {
    mkdirSync(temporary);
    try { writeFileSync(join(temporary, 'report.json'), JSON.stringify({ ...body, reportHash }, null, 2) + '\n', { flag: 'wx' }); renameSync(temporary, destination); }
    finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  const saved = JSON.parse(readFileSync(join(destination, 'report.json'), 'utf8'));
  const { reportHash: savedHash, ...savedBody } = saved;
  if (savedHash !== reportHash || newsEvidenceHash(savedBody) !== reportHash) throw new Error('Report integrity failure.');
  if (values.database) {
    database = openDatabase(values.database);
    setSetting('news_study_status_v1', reports.every(r => r.status === 'evaluated') ? 'evaluated' : 'insufficient_evidence', database);
  }
  console.log(JSON.stringify({ reportHash, directory: destination, studies: reports.map(r => ({ status: r.status, cadence: r.manifest.spec.cadence,
    horizonHours: r.manifest.spec.horizonHours, reasons: r.reasons, prospectiveRows: r.prospectiveRowCount })), networkRequests: 0 }));
} catch { console.error('News research failed. Provide verified archives, one feature version, an explicit code revision and output directory.'); process.exitCode = 1; }
finally { database?.close(); }
