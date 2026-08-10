import { createHash } from 'node:crypto';

import {
  instrumentKey,
  type InstrumentIdentity,
} from '@coqui/core';

import type { HttpClient } from '../http/index.js';
import { COINBASE_EXCHANGE_HOST } from './public.js';

const DAY_MS = 86_400_000;
const DAY_SECONDS = 86_400;
const PAGE_DAYS = 300;
const COMPLETION_DELAY_MS = 5 * 60_000;
const MAX_DAYS = 10_000;
const MAX_PAGE_BYTES = 5_000_000;
const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

export interface CoinbaseDailyArchiveRequest {
  readonly instrument: InstrumentIdentity;
  readonly startTimeMs: number;
  readonly endExclusiveMs: number;
  readonly retrievedAtMs: number;
}

export interface CoinbaseDailyArchiveRecord {
  readonly instrument: InstrumentIdentity;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly isComplete: true;
}

export interface CoinbaseDailyArchivePage {
  readonly requestStartTimeMs: number;
  readonly requestEndExclusiveMs: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly recordCount: number;
}

export interface CoinbaseDailyArchiveManifest {
  readonly schemaVersion: 1;
  readonly source: 'coinbase-exchange-rest';
  readonly market: 'spot';
  readonly interval: '1d';
  readonly productId: string;
  readonly startTimeMs: number;
  readonly endExclusiveMs: number;
  readonly retrievedAtMs: number;
  readonly pageCount: number;
  readonly recordCount: number;
  readonly firstStartTimeMs: number | null;
  readonly lastStartTimeMs: number | null;
  readonly pages: readonly CoinbaseDailyArchivePage[];
  readonly archivePath: string;
  readonly archiveSha256: string;
  readonly archiveByteLength: number;
  readonly manifestHash: string;
}

export type CoinbaseDailyArchiveResult =
  | {
      readonly ok: true;
      readonly records: readonly CoinbaseDailyArchiveRecord[];
      readonly manifest: CoinbaseDailyArchiveManifest;
      readonly rawArtifactText: string;
    }
  | {
      readonly ok: false;
      readonly code: 'request_failed' | 'invalid_response' | 'conflicting_interval';
      readonly status: number;
    };

interface RawPage {
  readonly requestStartTimeMs: number;
  readonly requestEndExclusiveMs: number;
  readonly body: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validateRequest(request: CoinbaseDailyArchiveRequest): void {
  instrumentKey(request.instrument);
  if (request.instrument.venue !== 'coinbase' || request.instrument.productType !== 'spot') {
    throw new TypeError('Coinbase archive acquisition requires a Coinbase spot instrument.');
  }
  for (const boundary of [request.startTimeMs, request.endExclusiveMs]) {
    if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary % DAY_MS !== 0) {
      throw new TypeError('Coinbase archive boundaries must be UTC midnights.');
    }
  }
  const days = (request.endExclusiveMs - request.startTimeMs) / DAY_MS;
  if (!Number.isSafeInteger(days) || days <= 0 || days > MAX_DAYS) {
    throw new RangeError(`Coinbase archive coverage must be between 1 and ${MAX_DAYS} days.`);
  }
  if (!Number.isSafeInteger(request.retrievedAtMs) ||
      request.retrievedAtMs < request.endExclusiveMs + COMPLETION_DELAY_MS) {
    throw new TypeError('retrievedAtMs must be after the requested final bar completed.');
  }
}

function decimalText(token: string, positive: boolean): string | null {
  if (token.startsWith('-')) return null;
  const [coefficient = '', exponentText] = token.toLowerCase().split('e');
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
  const [integer = '', fraction = ''] = coefficient.split('.');
  const digits = `${integer}${fraction}`;
  const decimalPosition = integer.length + exponent;
  const expanded = decimalPosition <= 0
    ? `0.${'0'.repeat(-decimalPosition)}${digits}`
    : decimalPosition >= digits.length
      ? `${digits}${'0'.repeat(decimalPosition - digits.length)}`
      : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  const value = Number(expanded);
  if (!Number.isFinite(value) || (positive ? value <= 0 : value < 0)) return null;
  return expanded;
}

function parsePage(
  text: string,
  request: CoinbaseDailyArchiveRequest,
): readonly CoinbaseDailyArchiveRecord[] | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_PAGE_BYTES) return null;
  let cursor = 0;
  const whitespace = (): void => {
    while (/\s/u.test(text[cursor] ?? '')) cursor += 1;
  };
  const character = (expected: string): boolean => {
    whitespace();
    if (text[cursor] !== expected) return false;
    cursor += 1;
    return true;
  };
  const numberToken = (): string | null => {
    whitespace();
    NUMBER_PATTERN.lastIndex = cursor;
    const match = NUMBER_PATTERN.exec(text);
    if (match === null) return null;
    cursor = NUMBER_PATTERN.lastIndex;
    return match[0];
  };
  if (!character('[')) return null;
  whitespace();
  if (text[cursor] === ']') {
    cursor += 1;
    whitespace();
    return cursor === text.length ? Object.freeze([]) : null;
  }
  const records: CoinbaseDailyArchiveRecord[] = [];
  while (cursor < text.length) {
    if (!character('[')) return null;
    const values: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const value = numberToken();
      if (value === null) return null;
      values.push(value);
      if (index < 5 && !character(',')) return null;
    }
    if (!character(']')) return null;
    const timeS = INTEGER_PATTERN.test(values[0]!) ? Number(values[0]) : Number.NaN;
    const low = decimalText(values[1]!, true);
    const high = decimalText(values[2]!, true);
    const open = decimalText(values[3]!, true);
    const close = decimalText(values[4]!, true);
    const volume = decimalText(values[5]!, false);
    const startTimeMs = timeS * 1_000;
    if (!Number.isSafeInteger(timeS) || timeS % DAY_SECONDS !== 0 ||
        !Number.isSafeInteger(startTimeMs) || low === null || high === null ||
        open === null || close === null || volume === null ||
        Number(high) < Number(low) || Number(open) < Number(low) ||
        Number(open) > Number(high) || Number(close) < Number(low) ||
        Number(close) > Number(high)) return null;
    records.push(Object.freeze({
      instrument: request.instrument,
      startTimeMs,
      endTimeMs: startTimeMs + DAY_MS,
      open,
      high,
      low,
      close,
      volume,
      isComplete: true,
    }));
    whitespace();
    if (text[cursor] === ',') {
      cursor += 1;
      continue;
    }
    if (text[cursor] !== ']') return null;
    cursor += 1;
    whitespace();
    return cursor === text.length ? Object.freeze(records) : null;
  }
  return null;
}

/** Re-derive page and record hashes before trusting a preserved Coinbase acquisition. */
export function verifyCoinbaseDailyArchiveArtifact(
  manifest: CoinbaseDailyArchiveManifest,
  rawArtifactText: string,
): readonly CoinbaseDailyArchiveRecord[] {
  if (manifest.schemaVersion !== 1 || manifest.source !== 'coinbase-exchange-rest' ||
      manifest.market !== 'spot' || manifest.interval !== '1d') {
    throw new TypeError('Unsupported Coinbase acquisition manifest.');
  }
  const instrument = {
    venue: 'coinbase', productId: manifest.productId, productType: 'spot',
  } as const;
  const request = {
    instrument,
    startTimeMs: manifest.startTimeMs,
    endExclusiveMs: manifest.endExclusiveMs,
    retrievedAtMs: manifest.retrievedAtMs,
  };
  validateRequest(request);
  const { manifestHash, ...stableManifest } = manifest;
  if (!/^[a-f0-9]{64}$/u.test(manifestHash) ||
      sha256(JSON.stringify(stableManifest)) !== manifestHash ||
      sha256(rawArtifactText) !== manifest.archiveSha256 ||
      Buffer.byteLength(rawArtifactText, 'utf8') !== manifest.archiveByteLength ||
      manifest.archivePath !== `${manifest.productId}.coinbase-candles.responses.json`) {
    throw new Error('Coinbase acquisition failed manifest or raw-content verification.');
  }
  let rawPages: unknown;
  try {
    rawPages = JSON.parse(rawArtifactText);
  } catch {
    throw new Error('Coinbase acquisition raw artifact is not valid JSON.');
  }
  if (!Array.isArray(rawPages) || rawPages.length !== manifest.pageCount ||
      manifest.pages.length !== manifest.pageCount) {
    throw new Error('Coinbase acquisition page count failed verification.');
  }
  const records = new Map<number, CoinbaseDailyArchiveRecord>();
  for (let index = 0; index < rawPages.length; index += 1) {
    const value = rawPages[index];
    const expected = manifest.pages[index];
    if (typeof value !== 'object' || value === null || expected === undefined) {
      throw new Error('Coinbase acquisition page metadata failed verification.');
    }
    const raw = value as Partial<RawPage>;
    if (!Number.isSafeInteger(raw.requestStartTimeMs) ||
        !Number.isSafeInteger(raw.requestEndExclusiveMs) || typeof raw.body !== 'string' ||
        raw.requestStartTimeMs !== expected.requestStartTimeMs ||
        raw.requestEndExclusiveMs !== expected.requestEndExclusiveMs ||
        sha256(raw.body) !== expected.sha256 ||
        Buffer.byteLength(raw.body, 'utf8') !== expected.byteLength) {
      throw new Error('Coinbase acquisition page content failed verification.');
    }
    const parsed = parsePage(raw.body, request);
    if (parsed === null) throw new Error('Coinbase acquisition page parsing failed verification.');
    let retained = 0;
    for (const record of parsed) {
      if (record.startTimeMs < expected.requestStartTimeMs ||
          record.startTimeMs > expected.requestEndExclusiveMs) {
        throw new Error('Coinbase acquisition page coverage failed verification.');
      }
      if (record.startTimeMs === expected.requestEndExclusiveMs) continue;
      if (records.has(record.startTimeMs)) {
        throw new Error('Coinbase acquisition contains duplicate retained intervals.');
      }
      records.set(record.startTimeMs, record);
      retained += 1;
    }
    if (retained !== expected.recordCount) {
      throw new Error('Coinbase acquisition page record count failed verification.');
    }
  }
  const ordered = [...records.values()].sort((left, right) => left.startTimeMs - right.startTimeMs);
  if (ordered.length !== manifest.recordCount ||
      (ordered[0]?.startTimeMs ?? null) !== manifest.firstStartTimeMs ||
      (ordered.at(-1)?.startTimeMs ?? null) !== manifest.lastStartTimeMs) {
    throw new Error('Coinbase acquisition record coverage failed verification.');
  }
  return Object.freeze(ordered);
}

/** Download exact raw daily candle pages and derive a content-bound Coinbase manifest. */
export async function downloadCoinbaseDailyArchive(
  http: HttpClient,
  request: CoinbaseDailyArchiveRequest,
): Promise<CoinbaseDailyArchiveResult> {
  validateRequest(request);
  const records = new Map<number, CoinbaseDailyArchiveRecord>();
  const rawPages: Array<{ requestStartTimeMs: number; requestEndExclusiveMs: number; body: string }> = [];
  const pages: CoinbaseDailyArchivePage[] = [];
  for (let endMs = request.endExclusiveMs; endMs > request.startTimeMs;) {
    const startMs = Math.max(request.startTimeMs, endMs - PAGE_DAYS * DAY_MS);
    const query = new URLSearchParams({
      granularity: String(DAY_SECONDS),
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    });
    const result = await http.getText(
      `https://${COINBASE_EXCHANGE_HOST}/products/` +
      `${encodeURIComponent(request.instrument.productId)}/candles?${query.toString()}`,
    );
    if (!result.ok) return { ok: false, code: 'request_failed', status: result.status };
    const parsed = parsePage(result.data, request);
    if (parsed === null) return { ok: false, code: 'invalid_response', status: result.status };
    let retained = 0;
    for (const record of parsed) {
      if (record.startTimeMs < startMs || record.startTimeMs > endMs) {
        return { ok: false, code: 'invalid_response', status: result.status };
      }
      if (record.startTimeMs === endMs) continue;
      const prior = records.get(record.startTimeMs);
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(record)) {
        return { ok: false, code: 'conflicting_interval', status: result.status };
      }
      if (prior === undefined) {
        records.set(record.startTimeMs, record);
        retained += 1;
      }
    }
    rawPages.push({ requestStartTimeMs: startMs, requestEndExclusiveMs: endMs, body: result.data });
    pages.push(Object.freeze({
      requestStartTimeMs: startMs,
      requestEndExclusiveMs: endMs,
      sha256: sha256(result.data),
      byteLength: Buffer.byteLength(result.data, 'utf8'),
      recordCount: retained,
    }));
    endMs = startMs;
  }
  rawPages.sort((left, right) => left.requestStartTimeMs - right.requestStartTimeMs);
  pages.sort((left, right) => left.requestStartTimeMs - right.requestStartTimeMs);
  const orderedRecords = [...records.values()].sort(
    (left, right) => left.startTimeMs - right.startTimeMs,
  );
  const rawArtifactText = JSON.stringify(rawPages);
  const archivePath = `${request.instrument.productId}.coinbase-candles.responses.json`;
  const stableManifest = {
    schemaVersion: 1 as const,
    source: 'coinbase-exchange-rest' as const,
    market: 'spot' as const,
    interval: '1d' as const,
    productId: request.instrument.productId,
    startTimeMs: request.startTimeMs,
    endExclusiveMs: request.endExclusiveMs,
    retrievedAtMs: request.retrievedAtMs,
    pageCount: pages.length,
    recordCount: orderedRecords.length,
    firstStartTimeMs: orderedRecords[0]?.startTimeMs ?? null,
    lastStartTimeMs: orderedRecords.at(-1)?.startTimeMs ?? null,
    pages: Object.freeze(pages),
    archivePath,
    archiveSha256: sha256(rawArtifactText),
    archiveByteLength: Buffer.byteLength(rawArtifactText, 'utf8'),
  };
  return Object.freeze({
    ok: true,
    records: Object.freeze(orderedRecords),
    rawArtifactText,
    manifest: Object.freeze({
      ...stableManifest,
      manifestHash: sha256(JSON.stringify(stableManifest)),
    }),
  });
}
