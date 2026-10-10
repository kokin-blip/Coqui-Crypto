import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { DuckDBInstance, version as duckdbVersion } from '@duckdb/node-api';
import { newsAnalysisChunkSchema, newsFeatureSnapshotSchema, newsObservationAnalysisSchema, epochMillisecondsSchema as ms, newsArchiveObservationSchema as stored, newsArchivePayloadSchemas as payloadSchemas, newsArchiveRecordSchema as recordSchema, newsArchiveManifestSchema as manifestSchema, type NewsArchiveManifest } from '@coqui/contracts';
import { canonicalJson, newsEvidenceHash, type CanonicalJsonValue } from '@coqui/core';
import { pageNewsObservationRevisionsAsOf } from '../repositories/news.js';
import { listNewsRunAnalyses, listNewsRunClusters, readNewsAnalysisRun } from '../repositories/news-intelligence.js';
import { inTransaction, type Db } from '../sqlite/index.js';
import { sha256File, validateContainedPath } from './common.js';
import { validateNewsArchiveProvenance } from './news-provenance.js';

type Kind = keyof typeof payloadSchemas;
interface RecordRow { kind: Kind; key: string; payload: unknown; contentHash: string }
function record(kind: Kind, key: string, value: unknown): RecordRow {
  const payload = payloadSchemas[kind].parse(value);
  if (kind === 'observation' && stored.parse(payload).observation.provider !== 'gdelt' ||
    kind === 'analysis' && newsObservationAnalysisSchema.parse(payload).provider !== 'gdelt' ||
    kind === 'feature' && newsFeatureSnapshotSchema.parse(payload).coverage.some(c => c.provider !== 'gdelt')) {
    throw new Error('Metered-provider archival permission is not enabled.');
  }
  return { kind, key, payload, contentHash: newsEvidenceHash(payload) };
}
function sqlText(s: string): string { return `'${s.replaceAll("'", "''")}'`; }
function datasetHash(rows: readonly RecordRow[], cutoff: number, revision: string): string {
  return newsEvidenceHash({ schema: 'news-archive-v1', inputCutoffMs: cutoff, codeRevision: revision, rows });
}
/** Snapshot SQLite evidence, then write verified Parquet without holding a database transaction over I/O. */
export async function writeNewsArchive(input: { readonly database: Db; readonly rootDir: string; readonly cutoffMs: number;
  readonly createdAtMs: number; readonly codeRevision: string }): Promise<NewsArchiveManifest> {
  ms.parse(input.cutoffMs); ms.parse(input.createdAtMs);
  if (input.createdAtMs < input.cutoffMs || !input.codeRevision || input.codeRevision.length > 200) throw new TypeError('Invalid news archive provenance.');
  const rows = inTransaction(input.database, () => {
    const result: RecordRow[] = [];
    let cursor: string | null = null;
    do {
      const page = pageNewsObservationRevisionsAsOf(input.cutoffMs, cursor, 250, input.database);
      for (const o of page.observations) result.push(record('observation', o.observationId, o));
      cursor = page.nextCursor;
      if (result.length > 100_000) throw new Error('News archive input exceeds bound.');
    } while (cursor !== null);
    const runs = input.database.prepare('SELECT id FROM news_analysis_runs_v1 WHERE persisted_at<=? ORDER BY id LIMIT 10001').all(input.cutoffMs) as unknown as { id: string }[];
    if (runs.length > 10_000) throw new Error('News archive run input exceeds bound.');
    for (const r of runs) {
      result.push(record('run', r.id, readNewsAnalysisRun(r.id, input.database)));
      for (const a of listNewsRunAnalyses(r.id, input.database)) result.push(record('analysis', `${r.id}:${a.observationId}`, a));
      for (const c of listNewsRunClusters(r.id, input.database)) result.push(record('cluster', `${r.id}:${c.id}`, c));
      const features = input.database.prepare('SELECT evidence_json,content_hash FROM news_feature_snapshots_v1 WHERE run_id=? ORDER BY id').all(r.id) as unknown as { evidence_json: string; content_hash: string }[];
      for (const f of features) {
        const value = newsFeatureSnapshotSchema.parse(JSON.parse(f.evidence_json));
        if (newsEvidenceHash(value) !== f.content_hash) throw new Error('News feature integrity failure.');
        result.push(record('feature', value.id, value));
      }
      if (result.length > 100_000) throw new Error('News archive output exceeds bound.');
    }
    const chunks = input.database.prepare('SELECT id,evidence_json,content_hash FROM news_analysis_chunks_v1 WHERE persisted_at<=? ORDER BY id LIMIT 10001').all(input.cutoffMs) as unknown as { id: string; evidence_json: string; content_hash: string }[];
    if (chunks.length > 10_000) throw new Error('News archive chunk input exceeds bound.');
    for (const row of chunks) {
      const chunk = newsAnalysisChunkSchema.parse(JSON.parse(row.evidence_json));
      if (newsEvidenceHash(chunk) !== row.content_hash) throw new Error('News chunk integrity failure.');
      result.push(record('chunk', row.id, chunk));
      const cache = input.database.prepare('SELECT observation_id,evidence_json,content_hash FROM news_cached_analyses_v1 WHERE chunk_id=? ORDER BY observation_id').all(row.id) as unknown as { observation_id: string; evidence_json: string; content_hash: string }[];
      for (const a of cache) {
        const value = newsObservationAnalysisSchema.parse(JSON.parse(a.evidence_json));
        if (newsEvidenceHash(value) !== a.content_hash || !chunk.observationIds.includes(a.observation_id)) throw new Error('News cached analysis integrity failure.');
        result.push(record('analysis', `${row.id}:${a.observation_id}`, value));
      }
      if (result.length > 100_000) throw new Error('News archive chunk output exceeds bound.');
    }
    return result.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
  });
  if (!rows.length) throw new Error('No eligible news evidence to archive.');
  validateNewsArchiveProvenance(rows, input.cutoffMs);
  const digest = datasetHash(rows, input.cutoffMs, input.codeRevision);
  const parent = join(resolve(input.rootDir), 'news'), destination = join(parent, digest);
  if (existsSync(destination)) return (await readNewsArchive(destination)).manifest;
  mkdirSync(parent, { recursive: true });
  const temporary = join(parent, `.${digest}.${randomUUID()}`); mkdirSync(temporary);
  const instance = await DuckDBInstance.create(':memory:'); const connection = await instance.connect();
  try {
    await connection.run('CREATE TABLE evidence(kind VARCHAR,record_key VARCHAR,payload_json VARCHAR,content_hash VARCHAR)');
    const appender = await connection.createAppender('evidence');
    try { for (const r of rows) {
      appender.appendVarchar(r.kind); appender.appendVarchar(r.key);
      appender.appendVarchar(canonicalJson(r.payload as CanonicalJsonValue)); appender.appendVarchar(r.contentHash); appender.endRow();
    } appender.flushSync(); } finally { appender.closeSync(); }
    const path = 'evidence.parquet';
    await connection.run(`COPY (SELECT * FROM evidence ORDER BY kind,record_key) TO ${sqlText(join(temporary, path))} (FORMAT parquet, COMPRESSION zstd)`);
    const file = await sha256File(join(temporary, path));
    const body = { schemaVersion: 1 as const, datasetHash: digest, inputCutoffMs: input.cutoffMs, createdAtMs: input.createdAtMs,
      codeRevision: input.codeRevision, recordCount: rows.length, dependencies: { duckdb: duckdbVersion(), node: process.version },
      attribution: 'GDELT Project — https://www.gdeltproject.org/' as const,
      files: [{ path, sha256: file.hash, byteLength: file.bytes, rowCount: rows.length }] };
    const manifest = manifestSchema.parse({ ...body, manifestHash: newsEvidenceHash(body) });
    writeFileSync(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    try { renameSync(temporary, destination); } catch (error) { if (!existsSync(destination)) throw error; }
    return (await readNewsArchive(destination)).manifest;
  } finally { connection.closeSync(); instance.closeSync(); rmSync(temporary, { recursive: true, force: true }); }
}
/** Verify bytes, semantic evidence, retention policy and content-addressed identity before reading. */
export async function readNewsArchive(directoryValue: string): Promise<{ readonly manifest: NewsArchiveManifest; readonly records: readonly RecordRow[] }> {
  const directory = resolve(directoryValue), manifest = manifestSchema.parse(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')));
  const { manifestHash, ...body } = manifest;
  if (manifestHash !== newsEvidenceHash(body) || basename(directory) !== manifest.datasetHash) throw new Error('News manifest integrity failure.');
  const records: RecordRow[] = [], instance = await DuckDBInstance.create(':memory:'); const connection = await instance.connect();
  try {
    for (const file of manifest.files) {
      const path = validateContainedPath(directory, file.path), digest = await sha256File(path);
      if (digest.hash !== file.sha256 || digest.bytes !== file.byteLength) throw new Error('News Parquet integrity failure.');
      const reader = await connection.runAndReadAll(`SELECT kind,record_key,payload_json,content_hash FROM read_parquet(${sqlText(path)}) ORDER BY kind,record_key`);
      const values = reader.getRowObjectsJson();
      if (values.length !== file.rowCount || records.length + values.length > 100_000) throw new Error('News archive row count exceeds manifest or bound.');
      for (const value of values) {
        const parsed = recordSchema.parse({ kind: value['kind'], key: value['record_key'], payload: JSON.parse(String(value['payload_json'])), contentHash: value['content_hash'] });
        const row = record(parsed.kind, parsed.key, parsed.payload);
        if (row.contentHash !== parsed.contentHash) throw new Error('News evidence integrity failure.'); records.push(row);
      }
    }
    records.sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key));
    if (records.length !== manifest.recordCount || new Set(records.map(r => `${r.kind}:${r.key}`)).size !== records.length ||
      datasetHash(records, manifest.inputCutoffMs, manifest.codeRevision) !== manifest.datasetHash) throw new Error('News semantic manifest differs.');
    validateNewsArchiveProvenance(records, manifest.inputCutoffMs);
    return { manifest, records };
  } finally { connection.closeSync(); instance.closeSync(); }
}
