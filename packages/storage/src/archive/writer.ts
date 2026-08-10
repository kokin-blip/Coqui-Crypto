import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { DuckDBInstance, version as duckdbVersion } from '@duckdb/node-api';

import type { MarketBarRecord } from '../repositories/market-data.js';
import {
  ARCHIVE_SCHEMA,
  canonicalRecords,
  canonicalSources,
  compareText,
  schemaHash,
  sha256File,
  sha256Text,
  stableDatasetHash,
  validateSafeSegment,
} from './common.js';
import type {
  ArchiveSourceArtifact,
  ArchivedMarketBar,
  MarketBarArchiveFile,
  MarketBarArchiveManifest,
} from './types.js';

export interface WriteMarketBarArchiveRequest {
  readonly rootDir: string;
  readonly records: readonly MarketBarRecord[];
  readonly sourceArtifacts: readonly ArchiveSourceArtifact[];
  readonly codeRevision: string;
  readonly createdAtMs: number;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function appendRecord(appender: Awaited<ReturnType<import('@duckdb/node-api').DuckDBConnection['createAppender']>>, record: ArchivedMarketBar): void {
  appender.appendVarchar(record.source);
  appender.appendVarchar(record.venue);
  appender.appendVarchar(record.productId);
  appender.appendVarchar(record.productType);
  appender.appendVarchar(record.providerAssetId);
  appender.appendVarchar(record.interval);
  appender.appendInteger(record.year);
  appender.appendBigInt(BigInt(record.startTimeMs));
  appender.appendBigInt(BigInt(record.endTimeMs));
  appender.appendVarchar(record.open);
  appender.appendVarchar(record.high);
  appender.appendVarchar(record.low);
  appender.appendVarchar(record.close);
  if (record.volume === null) appender.appendNull(); else appender.appendVarchar(record.volume);
  appender.appendBoolean(record.isComplete);
  appender.appendVarchar(record.quality);
  appender.appendBigInt(BigInt(record.retrievedAtMs));
  appender.endRow();
}

function partitionKey(record: ArchivedMarketBar): string {
  return `${record.venue}|${record.productId}|${record.productType}|${record.interval}|${record.year}`;
}

async function writeFiles(
  directory: string,
  records: readonly ArchivedMarketBar[],
): Promise<readonly MarketBarArchiveFile[]> {
  const instance = await DuckDBInstance.create(':memory:', { access_mode: 'read_write' });
  const connection = await instance.connect();
  try {
    await connection.run(`CREATE TABLE bars (${ARCHIVE_SCHEMA.map(
      ([name, type]) => `${name} ${type}`,
    ).join(', ')})`);
    const appender = await connection.createAppender('bars');
    try {
      for (const record of records) appendRecord(appender, record);
      appender.flushSync();
    } finally {
      appender.closeSync();
    }
    const partitions = new Map<string, ArchivedMarketBar[]>();
    for (const record of records) {
      const key = partitionKey(record);
      const rows = partitions.get(key) ?? [];
      rows.push(record);
      partitions.set(key, rows);
    }
    const files: MarketBarArchiveFile[] = [];
    for (const rows of partitions.values()) {
      const first = rows[0]!;
      for (const segment of [first.venue, first.productId, first.productType, first.interval]) {
        validateSafeSegment(segment, 'partition');
      }
      const output = join(
        directory, 'bars', first.venue, first.productId, first.productType,
        first.interval, String(first.year), 'part-00000.parquet',
      );
      mkdirSync(dirname(output), { recursive: true });
      await connection.run(`COPY (
        SELECT * FROM bars WHERE venue = $1 AND product_id = $2
          AND product_type = $3 AND interval = $4 AND year = $5
        ORDER BY source, start_time_ms
      ) TO ${sqlString(output)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`, [
        first.venue, first.productId, first.productType, first.interval, first.year,
      ]);
      const digest = await sha256File(output);
      files.push(Object.freeze({
        path: relative(directory, output).replaceAll('\\', '/'),
        sha256: digest.hash,
        byteLength: digest.bytes,
        rowCount: rows.length,
        venue: first.venue,
        productId: first.productId,
        productType: first.productType,
        interval: first.interval,
        year: first.year,
      }));
    }
    return Object.freeze(files.sort((left, right) => compareText(left.path, right.path)));
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function existingManifest(path: string, datasetHash: string): MarketBarArchiveManifest {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as MarketBarArchiveManifest;
  if (parsed.datasetHash !== datasetHash) {
    throw new Error('An immutable archive dataset directory already differs.');
  }
  return parsed;
}

/** Write one immutable, content-addressed Parquet dataset and provenance manifest. */
export async function writeMarketBarArchive(
  request: WriteMarketBarArchiveRequest,
): Promise<MarketBarArchiveManifest> {
  if (!Number.isSafeInteger(request.createdAtMs) || request.createdAtMs < 0) {
    throw new TypeError('createdAtMs must be a non-negative safe integer.');
  }
  if (request.codeRevision.length === 0 || request.codeRevision.length > 200) {
    throw new TypeError('codeRevision must be between 1 and 200 characters.');
  }
  const records = canonicalRecords(request.records);
  const sourceArtifacts = canonicalSources(request.sourceArtifacts);
  const currentSchemaHash = schemaHash();
  const dependencies = Object.freeze({ duckdb: duckdbVersion(), node: process.version });
  const datasetHash = stableDatasetHash({
    schemaHash: currentSchemaHash,
    codeRevision: request.codeRevision,
    dependencies,
    sourceArtifacts,
    records,
  });
  const root = resolve(request.rootDir);
  const destination = join(root, 'datasets', datasetHash);
  const manifestPath = join(destination, 'manifest.json');
  if (existsSync(manifestPath)) return existingManifest(manifestPath, datasetHash);
  mkdirSync(join(root, 'datasets'), { recursive: true });
  const temporary = join(root, 'datasets', `.${datasetHash}.${randomUUID()}`);
  mkdirSync(temporary, { recursive: false });
  try {
    const files = await writeFiles(temporary, records);
    const manifestWithoutHash = {
      schemaVersion: 1 as const,
      schemaHash: currentSchemaHash,
      datasetHash,
      createdAtMs: request.createdAtMs,
      codeRevision: request.codeRevision,
      dependencies,
      sourceArtifacts,
      recordCount: records.length,
      firstStartTimeMs: records[0]!.startTimeMs,
      lastStartTimeMs: records.at(-1)!.startTimeMs,
      files,
    };
    const manifest: MarketBarArchiveManifest = Object.freeze({
      ...manifestWithoutHash,
      manifestHash: sha256Text(JSON.stringify(manifestWithoutHash)),
    });
    writeFileSync(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    renameSync(temporary, destination);
    return manifest;
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: false });
    throw error;
  }
}
