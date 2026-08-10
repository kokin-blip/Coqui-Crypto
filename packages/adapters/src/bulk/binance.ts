import { createHash } from 'node:crypto';

import {
  instrumentKey,
  type InstrumentIdentity,
  type MarketBar,
} from '@coqui/core';
import { unzipSync } from 'fflate';

import type { HttpClient } from '../http/index.js';

const DAY_MS = 86_400_000;
const MAX_ARCHIVE_BYTES = 5_000_000;
const MAX_CSV_BYTES = 20_000_000;
const SYMBOL_PATTERN = /^[A-Z0-9]{5,24}$/u;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BASE_URL = 'https://data.binance.vision/data/spot/monthly/klines';

export interface BinanceMonthlyKlineRequest {
  readonly symbol: string;
  readonly year: number;
  readonly month: number;
  readonly retrievedAtMs: number;
}

export interface BinanceDailyKlineRecord {
  readonly instrument: InstrumentIdentity;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly quoteVolume: string;
  readonly tradeCount: number;
  readonly takerBuyBaseVolume: string;
  readonly takerBuyQuoteVolume: string;
  readonly isComplete: boolean;
}

export interface BinanceArchiveManifest {
  readonly source: 'binance-public-data';
  readonly market: 'spot';
  readonly interval: '1d';
  readonly symbol: string;
  readonly year: number;
  readonly month: number;
  readonly archivePath: string;
  readonly archiveSha256: string;
  readonly archiveByteLength: number;
  readonly csvEntryName: string;
  readonly csvSha256: string;
  readonly csvByteLength: number;
  readonly recordCount: number;
  readonly firstStartTimeMs: number | null;
  readonly lastStartTimeMs: number | null;
  readonly retrievedAtMs: number;
  readonly manifestHash: string;
}

export type BinanceArchiveFailureCode =
  | 'request_failed'
  | 'invalid_checksum'
  | 'checksum_mismatch'
  | 'invalid_archive'
  | 'invalid_csv';

export type BinanceArchiveImportResult =
  | {
      readonly ok: true;
      readonly records: readonly BinanceDailyKlineRecord[];
      readonly bars: readonly MarketBar[];
      readonly manifest: BinanceArchiveManifest;
      readonly archiveBytes: Uint8Array;
      readonly checksumText: string;
    }
  | {
      readonly ok: false;
      readonly code: BinanceArchiveFailureCode;
      readonly stage: 'checksum' | 'archive' | 'csv';
      readonly status: number;
    };

interface ArchiveNames {
  archivePath: string;
  archiveName: string;
  csvName: string;
}

function validateRequest(request: BinanceMonthlyKlineRequest): void {
  if (!SYMBOL_PATTERN.test(request.symbol)) {
    throw new TypeError('Binance symbols must be 5-24 uppercase alphanumeric characters.');
  }
  if (!Number.isSafeInteger(request.year) || request.year < 2017 || request.year > 9999) {
    throw new TypeError('Binance archive year must be between 2017 and 9999.');
  }
  if (!Number.isSafeInteger(request.month) || request.month < 1 || request.month > 12) {
    throw new TypeError('Binance archive month must be between 1 and 12.');
  }
  if (!Number.isSafeInteger(request.retrievedAtMs) || request.retrievedAtMs < 0) {
    throw new TypeError('retrievedAtMs must be a non-negative safe integer.');
  }
}

function names(request: BinanceMonthlyKlineRequest): ArchiveNames {
  const month = String(request.month).padStart(2, '0');
  const stem = `${request.symbol}-1d-${request.year}-${month}`;
  return {
    archivePath: `spot/monthly/klines/${request.symbol}/1d/${stem}.zip`,
    archiveName: `${stem}.zip`,
    csvName: `${stem}.csv`,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function checksum(text: string, expectedName: string): string | null {
  const parts = text.trim().split(/\s+/u);
  if (parts.length !== 2 || parts[1] !== expectedName) return null;
  const value = parts[0]?.toLowerCase() ?? '';
  return SHA256_PATTERN.test(value) ? value : null;
}

function exactDecimal(value: string, positive: boolean): number | null {
  if (!DECIMAL_PATTERN.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (positive ? number <= 0 : number < 0)) return null;
  return number;
}

function timestampMilliseconds(value: string): number | null {
  if (!INTEGER_PATTERN.test(value)) return null;
  const raw = BigInt(value);
  const milliseconds = raw >= 100_000_000_000_000n ? raw / 1_000n : raw;
  return milliseconds <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(milliseconds) : null;
}

function parseRecord(
  line: string,
  request: BinanceMonthlyKlineRequest,
  instrument: InstrumentIdentity,
): BinanceDailyKlineRecord | null {
  const values = line.split(',');
  if (values.length !== 12) return null;
  const startTimeMs = timestampMilliseconds(values[0]!);
  const closeTimeMs = timestampMilliseconds(values[6]!);
  const open = exactDecimal(values[1]!, true);
  const high = exactDecimal(values[2]!, true);
  const low = exactDecimal(values[3]!, true);
  const close = exactDecimal(values[4]!, true);
  const volume = exactDecimal(values[5]!, false);
  const quoteVolume = exactDecimal(values[7]!, false);
  const takerBase = exactDecimal(values[9]!, false);
  const takerQuote = exactDecimal(values[10]!, false);
  const tradeCount = INTEGER_PATTERN.test(values[8]!) ? Number(values[8]) : Number.NaN;
  const monthStart = Date.UTC(request.year, request.month - 1, 1);
  const monthEnd = Date.UTC(request.year, request.month, 1);
  if (
    startTimeMs === null || closeTimeMs === null || startTimeMs % DAY_MS !== 0 ||
    startTimeMs < monthStart || startTimeMs >= monthEnd ||
    closeTimeMs !== startTimeMs + DAY_MS - 1 ||
    open === null || high === null || low === null || close === null ||
    volume === null || quoteVolume === null || takerBase === null || takerQuote === null ||
    !Number.isSafeInteger(tradeCount) || tradeCount < 0 ||
    high < low || open < low || open > high || close < low || close > high
  ) return null;
  return Object.freeze({
    instrument,
    startTimeMs,
    endTimeMs: startTimeMs + DAY_MS,
    open: values[1]!,
    high: values[2]!,
    low: values[3]!,
    close: values[4]!,
    volume: values[5]!,
    quoteVolume: values[7]!,
    tradeCount,
    takerBuyBaseVolume: values[9]!,
    takerBuyQuoteVolume: values[10]!,
    isComplete: startTimeMs + DAY_MS <= request.retrievedAtMs,
  });
}

function parseCsv(
  bytes: Uint8Array,
  request: BinanceMonthlyKlineRequest,
): readonly BinanceDailyKlineRecord[] | null {
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
    venue: 'binance', productId: request.symbol, productType: 'spot',
  };
  const records: BinanceDailyKlineRecord[] = [];
  let previous = -1;
  for (const line of lines) {
    const record = parseRecord(line, request, instrument);
    if (record === null || record.startTimeMs <= previous) return null;
    previous = record.startTimeMs;
    records.push(record);
  }
  return Object.freeze(records);
}

function marketBars(
  records: readonly BinanceDailyKlineRecord[],
  retrievedAtMs: number,
): readonly MarketBar[] {
  return Object.freeze(records.map((record): MarketBar => Object.freeze({
    assetId: instrumentKey(record.instrument),
    source: 'binance',
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

/** Verify and parse one already-downloaded Binance monthly daily-kline archive. */
export function importBinanceMonthlyKlines(
  request: BinanceMonthlyKlineRequest,
  archiveBytes: Uint8Array,
  checksumText: string,
): BinanceArchiveImportResult {
  validateRequest(request);
  const archiveNames = names(request);
  if (archiveBytes.length === 0 || archiveBytes.length > MAX_ARCHIVE_BYTES) {
    return { ok: false, code: 'invalid_archive', stage: 'archive', status: 0 };
  }
  const expectedSha256 = checksum(checksumText, archiveNames.archiveName);
  if (expectedSha256 === null) {
    return { ok: false, code: 'invalid_checksum', stage: 'checksum', status: 0 };
  }
  const archiveSha256 = sha256(archiveBytes);
  if (archiveSha256 !== expectedSha256) {
    return { ok: false, code: 'checksum_mismatch', stage: 'checksum', status: 0 };
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archiveBytes);
  } catch {
    return { ok: false, code: 'invalid_archive', stage: 'archive', status: 0 };
  }
  const entryNames = Object.keys(entries);
  if (entryNames.length !== 1 || entryNames[0] !== archiveNames.csvName) {
    return { ok: false, code: 'invalid_archive', stage: 'archive', status: 0 };
  }
  const csvBytes = entries[archiveNames.csvName]!;
  const records = parseCsv(csvBytes, request);
  if (records === null) return { ok: false, code: 'invalid_csv', stage: 'csv', status: 0 };
  const stableManifest = {
    source: 'binance-public-data' as const,
    market: 'spot' as const,
    interval: '1d' as const,
    symbol: request.symbol,
    year: request.year,
    month: request.month,
    archivePath: archiveNames.archivePath,
    archiveSha256,
    archiveByteLength: archiveBytes.length,
    csvEntryName: archiveNames.csvName,
    csvSha256: sha256(csvBytes),
    csvByteLength: csvBytes.length,
    recordCount: records.length,
    firstStartTimeMs: records[0]?.startTimeMs ?? null,
    lastStartTimeMs: records.at(-1)?.startTimeMs ?? null,
  };
  const manifest: BinanceArchiveManifest = Object.freeze({
    ...stableManifest,
    retrievedAtMs: request.retrievedAtMs,
    manifestHash: sha256(new TextEncoder().encode(JSON.stringify(stableManifest))),
  });
  return {
    ok: true,
    records,
    bars: marketBars(records, request.retrievedAtMs),
    manifest,
    archiveBytes,
    checksumText,
  };
}

/** Download, checksum, and parse one explicit Binance monthly spot archive. */
export async function downloadBinanceMonthlyKlines(
  http: HttpClient,
  request: BinanceMonthlyKlineRequest,
): Promise<BinanceArchiveImportResult> {
  validateRequest(request);
  const archiveNames = names(request);
  const url = `${BASE_URL}/${request.symbol}/1d/${archiveNames.archiveName}`;
  const checksumResult = await http.getText(`${url}.CHECKSUM`);
  if (!checksumResult.ok) return {
    ok: false, code: 'request_failed', stage: 'checksum', status: checksumResult.status,
  };
  if (!http.getBytes) return {
    ok: false, code: 'request_failed', stage: 'archive', status: 0,
  };
  const archiveResult = await http.getBytes(url);
  if (!archiveResult.ok) return {
    ok: false, code: 'request_failed', stage: 'archive', status: archiveResult.status,
  };
  const imported = importBinanceMonthlyKlines(
    request, archiveResult.data, checksumResult.data,
  );
  if (!imported.ok) return { ...imported, status: archiveResult.status };
  return imported;
}
