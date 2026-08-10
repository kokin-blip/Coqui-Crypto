import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  downloadBinanceMonthlyKlines,
  importBinanceMonthlyKlines,
  type HttpClient,
} from '../packages/adapters/src/index.js';
import { persistBinanceDailyKlines } from '../packages/services/src/index.js';
import { listMarketBars, openDatabase } from '../packages/storage/src/index.js';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(name: string, contents: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const data = new TextEncoder().encode(contents);
  const checksum = crc32(data);
  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint32(14, checksum, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint32(16, checksum, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);

  const zip = new Uint8Array(local.length + central.length + end.length);
  zip.set(local, 0);
  zip.set(central, local.length);
  zip.set(end, local.length + central.length);
  return zip;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function csvRow(startTimeMs: number, microseconds = false): string {
  const start = microseconds ? BigInt(startTimeMs) * 1_000n : BigInt(startTimeMs);
  const close = microseconds
    ? BigInt(startTimeMs + 86_400_000) * 1_000n - 1n
    : BigInt(startTimeMs + 86_400_000 - 1);
  return [
    start, '100.00000000', '110.00000000', '90.00000000', '105.00000000',
    '12.50000000', close, '1300.00000000', '42', '6.00000000',
    '625.00000000', '0',
  ].join(',');
}

function fixture(year: number, month: number, rows: string): {
  zip: Uint8Array;
  checksum: string;
  name: string;
} {
  const stem = `BTCUSDT-1d-${year}-${String(month).padStart(2, '0')}`;
  const name = `${stem}.zip`;
  const zip = storedZip(`${stem}.csv`, `${rows}\n`);
  return { zip, checksum: `${sha256(zip)}  ${name}\n`, name };
}

function httpFor(zip: Uint8Array, checksum: string): HttpClient {
  return {
    getJson: async () => ({ ok: false, status: 500, reason: 'http', retried: 0 }),
    postJson: async () => ({ ok: false, status: 500, reason: 'http', retried: 0 }),
    getText: vi.fn(async () => ({ ok: true as const, status: 200, data: checksum })),
    getBytes: vi.fn(async () => ({ ok: true as const, status: 200, data: zip })),
    destroy: () => undefined,
  };
}

describe('Binance bulk archive importer', () => {
  it('verifies, extracts, and preserves exact decimal rows and provenance', () => {
    const start = Date.UTC(2024, 11, 1);
    const source = fixture(2024, 12, [csvRow(start), csvRow(start + 86_400_000)].join('\n'));
    const result = importBinanceMonthlyKlines({
      symbol: 'BTCUSDT', year: 2024, month: 12, retrievedAtMs: Date.UTC(2025, 0, 1),
    }, source.zip, source.checksum);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual(expect.objectContaining({
      instrument: { venue: 'binance', productId: 'BTCUSDT', productType: 'spot' },
      open: '100.00000000', close: '105.00000000', tradeCount: 42,
    }));
    expect(result.bars[0]).toEqual(expect.objectContaining({
      assetId: 'binance|spot|BTCUSDT', source: 'binance', interval: '1d',
    }));
    expect(result.manifest).toEqual(expect.objectContaining({
      archiveSha256: sha256(source.zip), recordCount: 2,
      manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it('normalizes Binance microsecond timestamps beginning in 2025', () => {
    const start = Date.UTC(2025, 0, 1);
    const source = fixture(2025, 1, csvRow(start, true));
    const result = importBinanceMonthlyKlines({
      symbol: 'BTCUSDT', year: 2025, month: 1, retrievedAtMs: start + 86_400_000,
    }, source.zip, source.checksum);
    expect(result.ok && result.records[0]?.startTimeMs).toBe(start);
  });

  it('persists exact Binance rows under a venue-isolated canonical identity', () => {
    const start = Date.UTC(2024, 11, 1);
    const source = fixture(2024, 12, csvRow(start));
    const result = importBinanceMonthlyKlines({
      symbol: 'BTCUSDT', year: 2024, month: 12, retrievedAtMs: start + 86_400_000,
    }, source.zip, source.checksum);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const database = openDatabase(':memory:');
    persistBinanceDailyKlines(result.records, start + 86_400_000, database);
    expect(listMarketBars({
      venue: 'binance', productId: 'BTCUSDT', productType: 'spot',
    }, database, 'binance')).toEqual([
      expect.objectContaining({
        source: 'binance', providerAssetId: 'BTCUSDT',
        open: '100.00000000', close: '105.00000000',
      }),
    ]);
    expect(listMarketBars({
      venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
    }, database, 'coinbase')).toEqual([]);
    database.close();
  });

  it('fails closed on checksum, entry-name, and CSV corruption', () => {
    const start = Date.UTC(2024, 11, 1);
    const valid = fixture(2024, 12, csvRow(start));
    const corrupted = Uint8Array.from(valid.zip);
    corrupted[10] = (corrupted[10] ?? 0) ^ 1;
    expect(importBinanceMonthlyKlines({
      symbol: 'BTCUSDT', year: 2024, month: 12, retrievedAtMs: start + 86_400_000,
    }, corrupted, valid.checksum)).toEqual(expect.objectContaining({
      ok: false, code: 'checksum_mismatch', stage: 'checksum',
    }));

    const wrongEntry = storedZip('unexpected.csv', `${csvRow(start)}\n`);
    expect(importBinanceMonthlyKlines({
      symbol: 'BTCUSDT', year: 2024, month: 12, retrievedAtMs: start + 86_400_000,
    }, wrongEntry, `${sha256(wrongEntry)}  ${valid.name}`)).toEqual(expect.objectContaining({
      ok: false, code: 'invalid_archive', stage: 'archive',
    }));

    const invalidCsv = fixture(2024, 12, csvRow(Date.UTC(2024, 10, 1)));
    expect(importBinanceMonthlyKlines({
      symbol: 'BTCUSDT', year: 2024, month: 12, retrievedAtMs: start + 86_400_000,
    }, invalidCsv.zip, invalidCsv.checksum)).toEqual(expect.objectContaining({
      ok: false, code: 'invalid_csv', stage: 'csv',
    }));
  });

  it('downloads only the validated explicit monthly path', async () => {
    const start = Date.UTC(2024, 11, 1);
    const source = fixture(2024, 12, csvRow(start));
    const http = httpFor(source.zip, source.checksum);
    const result = await downloadBinanceMonthlyKlines(http, {
      symbol: 'BTCUSDT', year: 2024, month: 12, retrievedAtMs: start + 86_400_000,
    });
    expect(result.ok).toBe(true);
    expect(http.getText).toHaveBeenCalledWith(
      'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-2024-12.zip.CHECKSUM',
    );
    expect(http.getBytes).toHaveBeenCalledWith(
      'https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1d/BTCUSDT-1d-2024-12.zip',
    );
  });
});
