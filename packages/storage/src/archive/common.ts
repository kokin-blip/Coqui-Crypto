import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { MarketBarRecord } from '../repositories/market-data.js';
import type { ArchiveSourceArtifact, ArchivedMarketBar } from './types.js';

export const ARCHIVE_SCHEMA = Object.freeze([
  ['source', 'VARCHAR'], ['venue', 'VARCHAR'], ['product_id', 'VARCHAR'],
  ['product_type', 'VARCHAR'], ['provider_asset_id', 'VARCHAR'], ['interval', 'VARCHAR'],
  ['year', 'INTEGER'], ['start_time_ms', 'BIGINT'], ['end_time_ms', 'BIGINT'],
  ['open_text', 'VARCHAR'], ['high_text', 'VARCHAR'], ['low_text', 'VARCHAR'],
  ['close_text', 'VARCHAR'], ['volume_text', 'VARCHAR'], ['is_complete', 'BOOLEAN'],
  ['quality', 'VARCHAR'], ['retrieved_at_ms', 'BIGINT'],
] as const);

const DAY_MS = 86_400_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function sha256File(path: string): Promise<{ hash: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { hash: hash.digest('hex'), bytes };
}

export function schemaHash(): string {
  return sha256Text(JSON.stringify(ARCHIVE_SCHEMA));
}

export function validateSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a safe non-empty path segment.`);
  }
}

export function validateHash(value: string, label: string): void {
  if (!HASH_PATTERN.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256.`);
}

export function validateContainedPath(root: string, path: string): string {
  if (isAbsolute(path) || path.includes('\\')) throw new TypeError('Archive paths must be relative.');
  const resolvedRoot = resolve(root);
  const resolved = resolve(root, path);
  const offset = relative(resolvedRoot, resolved);
  if (offset.startsWith('..') || isAbsolute(offset)) {
    throw new TypeError('Archive path escapes its dataset directory.');
  }
  return resolved;
}

function exactDecimal(value: string | null): boolean {
  return value === null || /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}

export function normalizedRecord(record: MarketBarRecord): ArchivedMarketBar {
  const year = new Date(record.startTimeMs).getUTCFullYear();
  return Object.freeze({
    source: record.source,
    venue: record.instrument.venue,
    productId: record.instrument.productId,
    productType: record.instrument.productType,
    providerAssetId: record.providerAssetId,
    interval: record.interval,
    year,
    startTimeMs: record.startTimeMs,
    endTimeMs: record.endTimeMs,
    open: record.open,
    high: record.high,
    low: record.low,
    close: record.close,
    volume: record.volume,
    isComplete: record.isComplete,
    quality: record.quality,
    retrievedAtMs: record.retrievedAtMs,
  });
}

export function validateRecord(record: ArchivedMarketBar): void {
  validateSafeSegment(record.source, 'source');
  validateSafeSegment(record.venue, 'venue');
  validateSafeSegment(record.productId, 'productId');
  validateSafeSegment(record.providerAssetId, 'providerAssetId');
  if (record.productType !== 'spot' || record.interval !== '1d') {
    throw new TypeError('The v1 market-bar archive supports daily spot rows only.');
  }
  if (
    !Number.isSafeInteger(record.startTimeMs) || record.startTimeMs < 0 ||
    record.startTimeMs % DAY_MS !== 0 || record.endTimeMs !== record.startTimeMs + DAY_MS ||
    !Number.isSafeInteger(record.retrievedAtMs) || record.retrievedAtMs < 0 ||
    record.year !== new Date(record.startTimeMs).getUTCFullYear()
  ) throw new TypeError('Archive timestamps must describe one exact UTC day.');
  if (
    !exactDecimal(record.open) || !exactDecimal(record.high) || !exactDecimal(record.low) ||
    !exactDecimal(record.close) || !exactDecimal(record.volume)
  ) throw new TypeError('Archive prices and volume must be exact non-negative decimal text.');
  const open = Number(record.open);
  const high = Number(record.high);
  const low = Number(record.low);
  const close = Number(record.close);
  const volume = record.volume === null ? 0 : Number(record.volume);
  if (
    ![open, high, low, close, volume].every(Number.isFinite) ||
    open <= 0 || high <= 0 || low <= 0 || close <= 0 ||
    high < low || open < low || open > high || close < low || close > high
  ) throw new TypeError('Archive rows must have valid positive OHLC relationships.');
}

export function canonicalRecords(records: readonly MarketBarRecord[]): readonly ArchivedMarketBar[] {
  if (records.length === 0) throw new TypeError('An archive dataset cannot be empty.');
  const normalized = records.map(normalizedRecord).sort((left, right) =>
    compareText(left.venue, right.venue) || compareText(left.productId, right.productId) ||
    compareText(left.source, right.source) || left.startTimeMs - right.startTimeMs);
  let prior = '';
  for (const record of normalized) {
    validateRecord(record);
    const key = `${record.source}|${record.venue}|${record.productType}|${record.productId}|` +
      `${record.interval}|${record.startTimeMs}`;
    if (key === prior) throw new TypeError('Archive rows contain a duplicate canonical interval.');
    prior = key;
  }
  return Object.freeze(normalized);
}

export function canonicalSources(
  sources: readonly ArchiveSourceArtifact[],
): readonly ArchiveSourceArtifact[] {
  if (sources.length === 0) throw new TypeError('At least one source artifact is required.');
  const sorted = [...sources].sort((left, right) => compareText(left.sourceId, right.sourceId));
  const seen = new Set<string>();
  for (const source of sorted) {
    if (source.sourceId.length === 0 || source.sourceId.length > 300) {
      throw new TypeError('sourceId must be between 1 and 300 characters.');
    }
    validateHash(source.manifestHash, 'manifestHash');
    validateHash(source.rawContentHash, 'rawContentHash');
    if (seen.has(source.sourceId)) throw new TypeError('Source artifact IDs must be unique.');
    seen.add(source.sourceId);
  }
  return Object.freeze(sorted.map((source) => Object.freeze({ ...source })));
}

export function stableDatasetHash(input: {
  schemaHash: string;
  codeRevision: string;
  dependencies: { duckdb: string; node: string };
  sourceArtifacts: readonly ArchiveSourceArtifact[];
  records: readonly ArchivedMarketBar[];
}): string {
  return sha256Text(JSON.stringify(input));
}
