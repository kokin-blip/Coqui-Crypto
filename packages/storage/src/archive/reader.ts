import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';

import {
  ARCHIVE_SCHEMA,
  schemaHash,
  sha256File,
  sha256Text,
  stableDatasetHash,
  validateContainedPath,
  validateHash,
  validateRecord,
  validateSafeSegment,
} from './common.js';
import type {
  ArchivedMarketBar,
  MarketBarArchiveFile,
  MarketBarArchiveManifest,
  MarketBarArchiveQuery,
} from './types.js';

type JsonRecord = Record<string, unknown>;

function object(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
  return value;
}

function integer(value: unknown, label: string): number {
  const numeric = typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || (numeric as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return numeric as number;
}

function parseFile(value: unknown): MarketBarArchiveFile {
  const row = object(value, 'archive file');
  const productType = text(row['productType'], 'file productType');
  const interval = text(row['interval'], 'file interval');
  if (productType !== 'spot' || interval !== '1d') throw new TypeError('Invalid file partition.');
  const file = {
    path: text(row['path'], 'file path'),
    sha256: text(row['sha256'], 'file sha256'),
    byteLength: integer(row['byteLength'], 'file byteLength'),
    rowCount: integer(row['rowCount'], 'file rowCount'),
    venue: text(row['venue'], 'file venue'),
    productId: text(row['productId'], 'file productId'),
    productType,
    interval,
    year: integer(row['year'], 'file year'),
  } as MarketBarArchiveFile;
  validateHash(file.sha256, 'file sha256');
  validateSafeSegment(file.venue, 'file venue');
  validateSafeSegment(file.productId, 'file productId');
  return Object.freeze(file);
}

function parseManifest(path: string): MarketBarArchiveManifest {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const value = object(raw, 'archive manifest');
  if (value['schemaVersion'] !== 1) throw new TypeError('Unsupported archive schema version.');
  const dependencies = object(value['dependencies'], 'dependencies');
  const sourceValues = value['sourceArtifacts'];
  const fileValues = value['files'];
  if (!Array.isArray(sourceValues) || sourceValues.length === 0 || !Array.isArray(fileValues)) {
    throw new TypeError('Archive provenance and files must be non-empty arrays.');
  }
  const sourceArtifacts = sourceValues.map((sourceValue) => {
    const source = object(sourceValue, 'source artifact');
    const result = {
      sourceId: text(source['sourceId'], 'sourceId'),
      manifestHash: text(source['manifestHash'], 'source manifestHash'),
      rawContentHash: text(source['rawContentHash'], 'source rawContentHash'),
    };
    validateHash(result.manifestHash, 'source manifestHash');
    validateHash(result.rawContentHash, 'source rawContentHash');
    return Object.freeze(result);
  });
  const manifest = {
    schemaVersion: 1 as const,
    schemaHash: text(value['schemaHash'], 'schemaHash'),
    datasetHash: text(value['datasetHash'], 'datasetHash'),
    manifestHash: text(value['manifestHash'], 'manifestHash'),
    createdAtMs: integer(value['createdAtMs'], 'createdAtMs'),
    codeRevision: text(value['codeRevision'], 'codeRevision'),
    dependencies: Object.freeze({
      duckdb: text(dependencies['duckdb'], 'DuckDB version'),
      node: text(dependencies['node'], 'Node version'),
    }),
    sourceArtifacts: Object.freeze(sourceArtifacts),
    recordCount: integer(value['recordCount'], 'recordCount'),
    firstStartTimeMs: integer(value['firstStartTimeMs'], 'firstStartTimeMs'),
    lastStartTimeMs: integer(value['lastStartTimeMs'], 'lastStartTimeMs'),
    files: Object.freeze(fileValues.map(parseFile)),
  };
  validateHash(manifest.schemaHash, 'schemaHash');
  validateHash(manifest.datasetHash, 'datasetHash');
  validateHash(manifest.manifestHash, 'manifestHash');
  const { manifestHash, ...withoutHash } = manifest;
  if (sha256Text(JSON.stringify(withoutHash)) !== manifestHash) {
    throw new Error('Archive manifest hash does not match its contents.');
  }
  return Object.freeze({ ...withoutHash, manifestHash });
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseArchivedRow(value: JsonRecord): ArchivedMarketBar {
  const productType = text(value['product_type'], 'product_type');
  const interval = text(value['interval'], 'interval');
  const quality = text(value['quality'], 'quality');
  if (productType !== 'spot' || interval !== '1d') throw new TypeError('Invalid archived row kind.');
  if (quality !== 'reported_ohlc' && quality !== 'close_only_legacy' &&
      quality !== 'synthetic_ohlc') throw new TypeError('Invalid archived row quality.');
  const volumeValue = value['volume_text'];
  const row: ArchivedMarketBar = Object.freeze({
    source: text(value['source'], 'source'),
    venue: text(value['venue'], 'venue'),
    productId: text(value['product_id'], 'product_id'),
    productType,
    providerAssetId: text(value['provider_asset_id'], 'provider_asset_id'),
    interval,
    year: integer(value['year'], 'year'),
    startTimeMs: integer(value['start_time_ms'], 'start_time_ms'),
    endTimeMs: integer(value['end_time_ms'], 'end_time_ms'),
    open: text(value['open_text'], 'open_text'),
    high: text(value['high_text'], 'high_text'),
    low: text(value['low_text'], 'low_text'),
    close: text(value['close_text'], 'close_text'),
    volume: volumeValue === null ? null : text(volumeValue, 'volume_text'),
    isComplete: value['is_complete'] === true,
    quality,
    retrievedAtMs: integer(value['retrieved_at_ms'], 'retrieved_at_ms'),
  });
  if (typeof value['is_complete'] !== 'boolean') throw new TypeError('is_complete must be boolean.');
  validateRecord(row);
  return row;
}

async function readRows(
  datasetDir: string,
  manifest: MarketBarArchiveManifest,
  query: MarketBarArchiveQuery = {},
): Promise<readonly ArchivedMarketBar[]> {
  const paths = manifest.files.map((file) => validateContainedPath(datasetDir, file.path));
  const conditions: string[] = [];
  if (query.venue !== undefined) {
    validateSafeSegment(query.venue, 'query venue');
    conditions.push(`venue = ${sqlString(query.venue)}`);
  }
  if (query.productId !== undefined) {
    validateSafeSegment(query.productId, 'query productId');
    conditions.push(`product_id = ${sqlString(query.productId)}`);
  }
  if (query.source !== undefined) {
    validateSafeSegment(query.source, 'query source');
    conditions.push(`source = ${sqlString(query.source)}`);
  }
  if (query.startTimeMs !== undefined) {
    conditions.push(`start_time_ms >= ${integer(query.startTimeMs, 'query startTimeMs')}`);
  }
  if (query.endTimeMs !== undefined) {
    conditions.push(`start_time_ms < ${integer(query.endTimeMs, 'query endTimeMs')}`);
  }
  const pathList = paths.map(sqlString).join(', ');
  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  try {
    const reader = await connection.runAndReadAll(`
      SELECT ${ARCHIVE_SCHEMA.map(([name]) => name).join(', ')}
      FROM read_parquet([${pathList}], hive_partitioning = false)
      ${where}
      ORDER BY venue, product_id, source, start_time_ms
    `);
    const expectedColumns = ARCHIVE_SCHEMA.map(([name]) => name);
    if (JSON.stringify(reader.columnNames()) !== JSON.stringify(expectedColumns)) {
      throw new Error('Parquet schema columns do not match archive schema v1.');
    }
    return Object.freeze(reader.getRowObjectsJson().map(parseArchivedRow));
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

/** Verify manifest, file hashes, schema, row count, and semantic dataset hash. */
export async function verifyMarketBarArchive(
  datasetDir: string,
): Promise<MarketBarArchiveManifest> {
  const directory = resolve(datasetDir);
  const manifestPath = join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('Archive manifest does not exist.');
  const manifest = parseManifest(manifestPath);
  if (basename(directory) !== manifest.datasetHash || manifest.schemaHash !== schemaHash()) {
    throw new Error('Archive directory or schema hash does not match the manifest.');
  }
  let fileRows = 0;
  for (const file of manifest.files) {
    const path = validateContainedPath(directory, file.path);
    const digest = await sha256File(path);
    if (digest.hash !== file.sha256 || digest.bytes !== file.byteLength) {
      throw new Error('Archived Parquet file failed content verification.');
    }
    fileRows += file.rowCount;
  }
  if (fileRows !== manifest.recordCount) throw new Error('Archive partition row counts disagree.');
  const records = await readRows(directory, manifest);
  if (records.length !== manifest.recordCount || records.length === 0) {
    throw new Error('Archived Parquet record count does not match the manifest.');
  }
  const calculated = stableDatasetHash({
    schemaHash: manifest.schemaHash,
    codeRevision: manifest.codeRevision,
    dependencies: manifest.dependencies,
    sourceArtifacts: manifest.sourceArtifacts,
    records,
  });
  if (calculated !== manifest.datasetHash) throw new Error('Archive semantic dataset hash differs.');
  return manifest;
}

/** Query a fully verified immutable Parquet dataset through an in-memory DuckDB instance. */
export async function queryMarketBarArchive(
  datasetDir: string,
  query: MarketBarArchiveQuery = {},
): Promise<readonly ArchivedMarketBar[]> {
  const manifest = await verifyMarketBarArchive(datasetDir);
  return readRows(resolve(datasetDir), manifest, query);
}
