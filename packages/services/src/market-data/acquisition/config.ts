import { resolve } from 'node:path';
import type { InstrumentIdentity } from '@coqui/core';

export const DAY_MS = 86_400_000;
export const PARSER_VERSION = 'market-foundation-v1';
export interface AcquisitionProduct {
  instrument: InstrumentIdentity & { venue: 'coinbase' | 'binance' | 'kraken' };
  baseAsset: string;
  quoteAsset: string;
}
export interface MarketAcquisitionConfig {
  schemaVersion: 1;
  refresh: boolean;
  products: AcquisitionProduct[];
  startTimeMs: number | null;
  endExclusiveMs: number;
  sourceDir: string;
  archiveDir: string;
  reportDir: string;
}
export function utcDate(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError('Dates must use YYYY-MM-DD.');
  }
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new TypeError('Invalid UTC calendar date.');
  }
  return time;
}
export function parseMarketAcquisitionConfig(value: unknown, nowMs: number): MarketAcquisitionConfig {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || typeof value !== 'object' || value === null) {
    throw new TypeError('Invalid acquisition configuration or clock.');
  }
  const input = value as Record<string, unknown>;
  if (input['schemaVersion'] !== 1 || !Array.isArray(input['products']) || input['products'].length === 0) {
    throw new TypeError('Configuration requires schemaVersion 1 and a nonempty product list.');
  }
  const seen = new Set<string>();
  const products = input['products'].map((item: unknown): AcquisitionProduct => {
    if (typeof item !== 'object' || item === null) throw new TypeError('Invalid product.');
    const product = item as Record<string, unknown>;
    const venue = product['venue'];
    if (venue !== 'coinbase' && venue !== 'binance' && venue !== 'kraken') {
      throw new TypeError('Unsupported acquisition venue.');
    }
    const productId = product['productId'];
    const baseAsset = product['baseAsset'];
    const quoteAsset = product['quoteAsset'];
    if (product['productType'] !== 'spot' || typeof productId !== 'string' ||
        !/^[A-Z0-9][A-Z0-9-]{2,23}$/u.test(productId) ||
        typeof baseAsset !== 'string' || !/^[A-Z0-9]{2,16}$/u.test(baseAsset) ||
        typeof quoteAsset !== 'string' || !/^[A-Z0-9]{2,16}$/u.test(quoteAsset)) {
      throw new TypeError('Products require explicit safe spot identity, base, and quote assets.');
    }
    if (venue !== 'coinbase' && !/^[A-Z0-9]+$/u.test(productId)) throw new TypeError('Invalid bulk symbol.');
    const key = `${venue}|spot|${productId}`;
    if (seen.has(key)) throw new TypeError('Duplicate canonical instrument.');
    seen.add(key);
    return { instrument: { venue, productId, productType: 'spot' }, baseAsset, quoteAsset };
  });
  const cutoff = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const endExclusiveMs = input['endExclusive'] === undefined ? cutoff : utcDate(input['endExclusive']);
  const startTimeMs = input['start'] === undefined ? null : utcDate(input['start']);
  if (endExclusiveMs > cutoff || (startTimeMs !== null && startTimeMs >= endExclusiveMs)) {
    throw new RangeError('Coverage must have positive duration and end before unfinished bars.');
  }
  const directory = (key: string, fallback: string): string => {
    const path = input[key] ?? fallback;
    if (typeof path !== 'string' || path.length === 0) throw new TypeError('Invalid output directory.');
    return resolve(path);
  };
  if (input['refresh'] !== undefined && typeof input['refresh'] !== 'boolean') throw new TypeError('refresh must be boolean.');
  return { schemaVersion: 1, refresh: input['refresh'] === true, products, startTimeMs, endExclusiveMs,
    sourceDir: directory('sourceDir', 'data/archive/market'),
    archiveDir: directory('archiveDir', 'data/research-archive'),
    reportDir: directory('reportDir', 'data/market-acquisition-reports') };
}
