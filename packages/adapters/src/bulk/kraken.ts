import { createHash, type Hash } from 'node:crypto';

import {
  instrumentKey,
  type InstrumentIdentity,
  type MarketBar,
} from '@coqui/core';
import { Unzip, UnzipInflate, UnzipPassThrough, type UnzipFile } from 'fflate';

const DAY_MS = 86_400_000;
const MAX_CSV_BYTES = 50_000_000;
const PAIR_PATTERN = /^[A-Z0-9]{3,24}$/u;
const ARCHIVE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.zip$/u;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export interface KrakenArchiveRequest {
  readonly pair: string;
  readonly archiveName: string;
  readonly origin: 'complete' | 'quarterly';
  readonly retrievedAtMs: number;
}

export interface KrakenDailyKlineRecord {
  readonly instrument: InstrumentIdentity;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly vwap: string | null;
  readonly volume: string;
  readonly tradeCount: number;
  readonly isComplete: boolean;
}

export interface KrakenArchiveManifest {
  readonly source: 'kraken-ohlcvt-archive';
  readonly origin: 'complete' | 'quarterly';
  readonly market: 'spot';
  readonly interval: '1440m';
  readonly pair: string;
  readonly archiveName: string;
  readonly archiveSha256: string;
  readonly archiveByteLength: number;
  readonly upstreamChecksumAvailable: false;
  readonly csvEntryName: string;
  readonly csvSha256: string;
  readonly csvByteLength: number;
  readonly recordCount: number;
  readonly firstStartTimeMs: number | null;
  readonly lastStartTimeMs: number | null;
  readonly missingDailyIntervals: number;
  readonly retrievedAtMs: number;
  readonly manifestHash: string;
}

export type KrakenArchiveFailureCode =
  | 'invalid_archive'
  | 'invalid_csv'
  | 'missing_pair'
  | 'duplicate_pair';

export type KrakenArchiveImportResult =
  | {
      readonly ok: true;
      readonly records: readonly KrakenDailyKlineRecord[];
      readonly bars: readonly MarketBar[];
      readonly manifest: KrakenArchiveManifest;
    }
  | {
      readonly ok: false;
      readonly code: KrakenArchiveFailureCode;
      readonly stage: 'archive' | 'csv';
    };

export interface KrakenArchiveImporter {
  push(chunk: Uint8Array, final?: boolean): void;
  finish(): KrakenArchiveImportResult;
}

function validateRequest(request: KrakenArchiveRequest): void {
  if (!PAIR_PATTERN.test(request.pair)) {
    throw new TypeError('Kraken pairs must be 3-24 uppercase alphanumeric characters.');
  }
  if (!ARCHIVE_NAME_PATTERN.test(request.archiveName)) {
    throw new TypeError('archiveName must be a safe ZIP basename.');
  }
  if (!Number.isSafeInteger(request.retrievedAtMs) || request.retrievedAtMs < 0) {
    throw new TypeError('retrievedAtMs must be a non-negative safe integer.');
  }
}

function safeEntryName(name: string): boolean {
  if (name.length === 0 || name.includes('\\') || name.startsWith('/')) return false;
  const parts = name.split('/');
  return parts.every((part) => part !== '.' && part !== '..' && !part.includes(':'));
}

function basename(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

function exactDecimal(value: string, positive: boolean): number | null {
  if (!DECIMAL_PATTERN.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || (positive ? numeric <= 0 : numeric < 0)) return null;
  return numeric;
}

function parseRecord(
  line: string,
  instrument: InstrumentIdentity,
  retrievedAtMs: number,
): KrakenDailyKlineRecord | null {
  const values = line.split(',');
  if (values.length !== 7 && values.length !== 8) return null;
  const timestamp = values[0]!;
  if (!INTEGER_PATTERN.test(timestamp)) return null;
  const seconds = Number(timestamp);
  const startTimeMs = seconds * 1_000;
  const vwapIndex = values.length === 8 ? 5 : -1;
  const volumeIndex = values.length === 8 ? 6 : 5;
  const tradesIndex = values.length === 8 ? 7 : 6;
  const open = exactDecimal(values[1]!, true);
  const high = exactDecimal(values[2]!, true);
  const low = exactDecimal(values[3]!, true);
  const close = exactDecimal(values[4]!, true);
  const vwap = vwapIndex === -1 ? null : exactDecimal(values[vwapIndex]!, true);
  const volume = exactDecimal(values[volumeIndex]!, false);
  const tradesText = values[tradesIndex]!;
  const tradeCount = INTEGER_PATTERN.test(tradesText) ? Number(tradesText) : Number.NaN;
  if (
    !Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(startTimeMs) ||
    startTimeMs % DAY_MS !== 0 || open === null || high === null || low === null ||
    close === null || (vwapIndex !== -1 && vwap === null) || volume === null ||
    !Number.isSafeInteger(tradeCount) || tradeCount < 0 || high < low ||
    open < low || open > high || close < low || close > high
  ) return null;
  return Object.freeze({
    instrument,
    startTimeMs,
    endTimeMs: startTimeMs + DAY_MS,
    open: values[1]!,
    high: values[2]!,
    low: values[3]!,
    close: values[4]!,
    vwap: vwapIndex === -1 ? null : values[vwapIndex]!,
    volume: values[volumeIndex]!,
    tradeCount,
    isComplete: startTimeMs + DAY_MS <= retrievedAtMs,
  });
}

function parseCsv(
  bytes: Uint8Array,
  request: KrakenArchiveRequest,
): readonly KrakenDailyKlineRecord[] | null {
  if (bytes.length === 0 || bytes.length > MAX_CSV_BYTES) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines.some((line) => line.length === 0)) return null;
  const instrument: InstrumentIdentity = {
    venue: 'kraken', productId: request.pair, productType: 'spot',
  };
  const records: KrakenDailyKlineRecord[] = [];
  let previous = -1;
  for (const line of lines) {
    const record = parseRecord(line, instrument, request.retrievedAtMs);
    if (record === null || record.startTimeMs <= previous) return null;
    previous = record.startTimeMs;
    records.push(record);
  }
  return Object.freeze(records);
}

function marketBars(
  records: readonly KrakenDailyKlineRecord[],
  retrievedAtMs: number,
): readonly MarketBar[] {
  return Object.freeze(records.map((record): MarketBar => Object.freeze({
    assetId: instrumentKey(record.instrument),
    source: 'kraken',
    interval: '1d',
    startTimeMs: record.startTimeMs,
    endTimeMs: record.endTimeMs,
    open: Number(record.open),
    high: Number(record.high),
    low: Number(record.low),
    close: Number(record.close),
    volume: Number(record.volume),
    isComplete: record.isComplete,
    retrievedAtMs,
    quality: 'reported_ohlc',
  })));
}

function missingIntervals(records: readonly KrakenDailyKlineRecord[]): number {
  let missing = 0;
  for (let index = 1; index < records.length; index += 1) {
    missing += (records[index]!.startTimeMs - records[index - 1]!.startTimeMs) / DAY_MS - 1;
  }
  return missing;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Stream one official Kraken OHLCVT ZIP and select an explicit daily pair CSV. */
export function createKrakenDailyArchiveImporter(
  request: KrakenArchiveRequest,
): KrakenArchiveImporter {
  validateRequest(request);
  const targetName = `${request.pair}_1440.csv`;
  const archiveHash: Hash = createHash('sha256');
  let archiveByteLength = 0;
  let targetEntryName = '';
  let targetCount = 0;
  let targetComplete = false;
  let finalPushed = false;
  let failure: KrakenArchiveFailureCode | null = null;
  const csvChunks: Uint8Array[] = [];
  let csvByteLength = 0;

  const selectFile = (file: UnzipFile): void => {
    if (!safeEntryName(file.name)) {
      failure = 'invalid_archive';
      return;
    }
    if (basename(file.name) !== targetName) return;
    targetCount += 1;
    if (targetCount > 1) {
      failure = 'duplicate_pair';
      return;
    }
    if (file.originalSize !== undefined && file.originalSize > MAX_CSV_BYTES) {
      failure = 'invalid_csv';
      return;
    }
    targetEntryName = file.name;
    file.ondata = (error, data, final) => {
      if (error) {
        failure = 'invalid_archive';
        return;
      }
      csvByteLength += data.length;
      if (csvByteLength > MAX_CSV_BYTES) {
        failure = 'invalid_csv';
        file.terminate();
        return;
      }
      csvChunks.push(data.slice());
      if (final) targetComplete = true;
    };
    file.start();
  };

  const unzip = new Unzip(selectFile);
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  return Object.freeze({
    push(chunk: Uint8Array, final = false): void {
      if (finalPushed) throw new Error('The Kraken archive stream has already ended.');
      archiveHash.update(chunk);
      archiveByteLength += chunk.length;
      try {
        unzip.push(chunk, final);
      } catch {
        failure = 'invalid_archive';
      }
      if (final) finalPushed = true;
    },
    finish(): KrakenArchiveImportResult {
      if (!finalPushed) throw new Error('The Kraken archive stream must be ended before finish().');
      if (failure !== null) {
        return { ok: false, code: failure, stage: failure === 'invalid_csv' ? 'csv' : 'archive' };
      }
      if (targetCount === 0) return { ok: false, code: 'missing_pair', stage: 'archive' };
      if (!targetComplete) return { ok: false, code: 'invalid_archive', stage: 'archive' };
      const csvBytes = new Uint8Array(csvByteLength);
      let offset = 0;
      for (const chunk of csvChunks) {
        csvBytes.set(chunk, offset);
        offset += chunk.length;
      }
      const records = parseCsv(csvBytes, request);
      if (records === null) return { ok: false, code: 'invalid_csv', stage: 'csv' };
      const stableManifest = {
        source: 'kraken-ohlcvt-archive' as const,
        origin: request.origin,
        market: 'spot' as const,
        interval: '1440m' as const,
        pair: request.pair,
        archiveName: request.archiveName,
        archiveSha256: archiveHash.digest('hex'),
        archiveByteLength,
        upstreamChecksumAvailable: false as const,
        csvEntryName: targetEntryName,
        csvSha256: hashBytes(csvBytes),
        csvByteLength,
        recordCount: records.length,
        firstStartTimeMs: records[0]?.startTimeMs ?? null,
        lastStartTimeMs: records.at(-1)?.startTimeMs ?? null,
        missingDailyIntervals: missingIntervals(records),
      };
      const manifest: KrakenArchiveManifest = Object.freeze({
        ...stableManifest,
        retrievedAtMs: request.retrievedAtMs,
        manifestHash: hashBytes(new TextEncoder().encode(JSON.stringify(stableManifest))),
      });
      return { ok: true, records, bars: marketBars(records, request.retrievedAtMs), manifest };
    },
  });
}
