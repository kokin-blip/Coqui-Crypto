import { describe, expect, it } from 'vitest';

import { createKrakenDailyArchiveImporter } from '../packages/adapters/src/index.js';
import { persistKrakenDailyKlines } from '../packages/services/src/index.js';
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

function storedZip(entries: ReadonlyArray<readonly [string, string]>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;
  for (const [name, contents] of entries) {
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
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(nameBytes, 46);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  const result = new Uint8Array(localOffset + centralSize + end.length);
  let offset = 0;
  for (const entry of [...locals, ...centrals, end]) {
    result.set(entry, offset);
    offset += entry.length;
  }
  return result;
}

function row(startTimeMs: number, withVwap = false): string {
  const values = [
    String(startTimeMs / 1_000), '100.000000000000000001', '110.00000000',
    '90.00000000', '105.123456789123456789', '12.500000000000000001', '42',
  ];
  if (withVwap) values.splice(5, 0, '102.500000000000000001');
  return values.join(',');
}

function importZip(zip: Uint8Array, retrievedAtMs: number) {
  const importer = createKrakenDailyArchiveImporter({
    pair: 'XBTUSD', archiveName: 'Kraken_OHLCVT.zip', origin: 'complete', retrievedAtMs,
  });
  for (let offset = 0; offset < zip.length; offset += 11) {
    const end = Math.min(offset + 11, zip.length);
    importer.push(zip.slice(offset, end), end === zip.length);
  }
  return importer.finish();
}

describe('Kraken bulk archive importer', () => {
  it('streams the selected daily CSV and preserves exact 7-column rows', () => {
    const start = Date.UTC(2024, 0, 1);
    const zip = storedZip([['XBTUSD_1440.csv', `${row(start)}\n`]]);
    const result = importZip(zip, start + 86_400_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]).toEqual(expect.objectContaining({
      instrument: { venue: 'kraken', productId: 'XBTUSD', productType: 'spot' },
      open: '100.000000000000000001', close: '105.123456789123456789',
      vwap: null, tradeCount: 42,
    }));
    expect(result.bars[0]).toEqual(expect.objectContaining({
      assetId: 'kraken|spot|XBTUSD', source: 'kraken', interval: '1d',
    }));
    expect(result.manifest).toEqual(expect.objectContaining({
      upstreamChecksumAvailable: false, recordCount: 1, missingDailyIntervals: 0,
      manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
  });

  it('accepts optional VWAP and records documented no-trade day gaps', () => {
    const start = Date.UTC(2024, 0, 1);
    const csv = `${row(start, true)}\n${row(start + 3 * 86_400_000, true)}\n`;
    const result = importZip(storedZip([['nested/XBTUSD_1440.csv', csv]]), start + 4 * 86_400_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.records[0]?.vwap).toBe('102.500000000000000001');
    expect(result.manifest.missingDailyIntervals).toBe(2);
  });

  it('persists exact rows under a venue-isolated canonical identity', () => {
    const start = Date.UTC(2024, 0, 1);
    const result = importZip(storedZip([['XBTUSD_1440.csv', `${row(start)}\n`]]),
      start + 86_400_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const database = openDatabase(':memory:');
    persistKrakenDailyKlines(result.records, start + 86_400_000, database);
    expect(listMarketBars({
      venue: 'kraken', productId: 'XBTUSD', productType: 'spot',
    }, database, 'kraken')).toEqual([expect.objectContaining({
      source: 'kraken', providerAssetId: 'XBTUSD',
      open: '100.000000000000000001', close: '105.123456789123456789',
    })]);
    expect(listMarketBars({
      venue: 'coinbase', productId: 'BTC-USD', productType: 'spot',
    }, database, 'coinbase')).toEqual([]);
    database.close();
  });

  it('fails closed on missing, duplicate, unsafe, and invalid pair data', () => {
    const start = Date.UTC(2024, 0, 1);
    expect(importZip(storedZip([['ETHUSD_1440.csv', `${row(start)}\n`]]),
      start + 86_400_000)).toEqual(expect.objectContaining({
      ok: false, code: 'missing_pair', stage: 'archive',
    }));
    expect(importZip(storedZip([
      ['XBTUSD_1440.csv', `${row(start)}\n`],
      ['nested/XBTUSD_1440.csv', `${row(start)}\n`],
    ]), start + 86_400_000)).toEqual(expect.objectContaining({
      ok: false, code: 'duplicate_pair', stage: 'archive',
    }));
    expect(importZip(storedZip([['../XBTUSD_1440.csv', `${row(start)}\n`]]),
      start + 86_400_000)).toEqual(expect.objectContaining({
      ok: false, code: 'invalid_archive', stage: 'archive',
    }));
    const invalidOhlc = row(start).replace('110.00000000', '80.00000000');
    expect(importZip(storedZip([['XBTUSD_1440.csv', `${invalidOhlc}\n`]]),
      start + 86_400_000)).toEqual(expect.objectContaining({
      ok: false, code: 'invalid_csv', stage: 'csv',
    }));
  });
});
