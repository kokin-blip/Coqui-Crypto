import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpClient, HttpResult } from '../packages/adapters/src/index.js';
import { queryMarketBarArchive } from '../packages/storage/src/index.js';
import { parseMarketAcquisitionConfig, runMarketAcquisition } from '../packages/services/src/index.js';
import { verifyEnvelope } from '../packages/services/src/market-data/acquisition/artifacts.js';
import { mergeAcquiredRecords } from '../packages/services/src/market-data/acquisition/records.js';
import { acquireBinanceProduct } from '../packages/services/src/market-data/acquisition/providers.js';
import { binanceZip, hash } from './market-acquisition-fixtures.js';

const roots: string[] = [];
const day = Date.UTC(2025, 0, 1);
const now = day + 86400000 + 600000;
function config(products = [
  { venue: 'binance', productId: 'BTCUSDT', productType: 'spot', baseAsset: 'BTC', quoteAsset: 'USDT' },
]) {
  const root = mkdtempSync(join(tmpdir(), 'coqui-market-')); roots.push(root);
  return parseMarketAcquisitionConfig({ schemaVersion: 1, start: '2025-01-01', endExclusive: '2025-01-02',
    products, sourceDir: join(root, 'raw'), archiveDir: join(root, 'parquet'), reportDir: join(root, 'reports') }, now);
}
function client(options: { dailyOnly?: boolean; close?: string; failed?: boolean } = {}): HttpClient {
  return {
    getText: vi.fn(async (url: string): Promise<HttpResult<string>> => {
      if (url.endsWith('.CHECKSUM')) {
        if (options.failed) return { ok: false, reason: 'http', retried: 0, status: 403 };
        if (options.dailyOnly && url.includes('/monthly/')) return { ok: false, reason: 'http', retried: 0, status: 404 };
        const name = url.split('/').at(-1)!.replace('.CHECKSUM', '');
        const bytes = binanceZip(name, day, options.close);
        return { ok: true, status: 200, data: `${hash(bytes)}  ${name}\n` };
      }
      if (url.includes('/candles?')) return { ok: true, status: 200,
        data: `[[${day / 1000},90.000,110.000,100.00000001,105.000,12.500]]` };
      return { ok: true, status: 200, data: 'source documentation and terms' };
    }),
    getBytes: vi.fn(async (url: string): Promise<HttpResult<Uint8Array>> => ({ ok: true, status: 200,
      data: binanceZip(url.split('/').at(-1)!, day, options.close) })),
    getJson: vi.fn(), postJson: vi.fn(), destroy: vi.fn(),
  };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('market acquisition foundation', () => {
  it('accepts an expandable universe and rejects invalid dates and duplicate identities', () => {
    const products = ['BTC', 'ETH', 'LTC'].map((baseAsset) => ({ venue: 'binance', productId: `${baseAsset}USDT`,
      productType: 'spot', baseAsset, quoteAsset: 'USDT' }));
    expect(config(products).products).toHaveLength(3);
    expect(() => config([products[0]!, products[0]!])).toThrow('Duplicate');
    expect(() => parseMarketAcquisitionConfig({ schemaVersion: 1, products, start: '2025-02-30' }, now)).toThrow();
    expect(() => parseMarketAcquisitionConfig({ schemaVersion: 1, products, endExclusive: '2025-01-03' }, now)).toThrow();
  });
  it('writes separate exact-decimal Parquet datasets and verifies sources without SQLite', async () => {
    const cfg = config([
      { venue: 'binance', productId: 'LTCUSDT', productType: 'spot', baseAsset: 'LTC', quoteAsset: 'USDT' },
      { venue: 'coinbase', productId: 'LTC-USD', productType: 'spot', baseAsset: 'LTC', quoteAsset: 'USD' },
    ]);
    const result = await runMarketAcquisition({ config: cfg, http: client(), codeRevision: 'test-v1', retrievedAtMs: now });
    expect(result.report.ok).toBe(true);
    for (const item of result.report.instruments) {
      const rows = await queryMarketBarArchive(item.datasetDir!);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.venue).toBe(item.product.instrument.venue);
      expect(rows[0]?.open).toBe(item.product.instrument.venue === 'binance' ? '100.00000000' : '100.00000001');
      for (const path of item.envelopePaths) {
        const envelope = await verifyEnvelope(path);
        expect(envelope.snapshots).toHaveLength(4);
        expect(envelope.configurationHash).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
    expect(readFileSync(join(result.directory, 'report.md'), 'utf8')).toContain('Status: **complete**');
  });
  it('reuses verified captures with original times and stable dataset hashes', async () => {
    const cfg = config(); const http = client();
    const first = await runMarketAcquisition({ config: cfg, http, codeRevision: 'test-v1', retrievedAtMs: now });
    const second = await runMarketAcquisition({ config: cfg, http, codeRevision: 'test-v1', retrievedAtMs: now + 1000 });
    expect(second.report.ok).toBe(true);
    expect(second.report.instruments[0]?.datasetHash).toBe(first.report.instruments[0]?.datasetHash);
    expect(http.getBytes).toHaveBeenCalledTimes(1);
    const rows = await queryMarketBarArchive(second.report.instruments[0]!.datasetDir!);
    expect(rows[0]?.retrievedAtMs).toBe(now);
  });
  it('falls back to daily archives only for a missing monthly archive', async () => {
    const cfg = config(); const http = client({ dailyOnly: true });
    const result = await runMarketAcquisition({ config: cfg, http, codeRevision: 'test', retrievedAtMs: now });
    expect(result.report.ok).toBe(true);
    expect(result.report.instruments[0]?.unavailablePeriods).toHaveLength(1);
    expect(http.getBytes).toHaveBeenCalledWith(expect.stringContaining('/daily/'));
    const failure = await runMarketAcquisition({ config: { ...cfg, refresh: true },
      http: client({ failed: true }), codeRevision: 'test', retrievedAtMs: now });
    expect(failure.report.ok).toBe(false);
    expect(failure.report.instruments[0]?.failure).toContain('403');
  });
  it('rejects tampered raw bytes and envelopes instead of trusting an index', async () => {
    const cfg = config();
    const first = await runMarketAcquisition({ config: cfg, http: client(), codeRevision: 'test', retrievedAtMs: now });
    const path = first.report.instruments[0]!.envelopePaths[0]!;
    const envelope = await verifyEnvelope(path);
    writeFileSync(envelope.artifacts[0]!.path, 'tampered');
    const second = await runMarketAcquisition({ config: cfg, http: client(), codeRevision: 'test', retrievedAtMs: now });
    expect(second.report.ok).toBe(false);
    expect(second.report.instruments[0]?.failure).toContain('verification');
    writeFileSync(path, JSON.stringify({ ...envelope, configurationHash: 'tampered' }));
    await expect(verifyEnvelope(path)).rejects.toThrow('envelope');
  });
  it('preserves corrected upstream versions and detects conflicting overlaps', async () => {
    const cfg = config();
    const first = await runMarketAcquisition({ config: cfg, http: client(), codeRevision: 'test', retrievedAtMs: now });
    const second = await runMarketAcquisition({ config: { ...cfg, refresh: true }, http: client({ close: '106.00000000' }),
      codeRevision: 'test', retrievedAtMs: now + 1000 });
    expect(second.report.ok).toBe(true);
    expect(second.report.instruments[0]?.datasetHash).not.toBe(first.report.instruments[0]?.datasetHash);
    await verifyEnvelope(first.report.instruments[0]!.envelopePaths[0]!);
    const record = { source: 'binance' as const, instrument: { venue: 'binance' as const, productId: 'BTCUSDT', productType: 'spot' as const },
      providerAssetId: 'BTCUSDT', interval: '1d' as const, startTimeMs: day, endTimeMs: day + 86400000,
      open: '100', high: '110', low: '90', close: '105', volume: '1', isComplete: true,
      quality: 'reported_ohlc' as const, retrievedAtMs: now };
    expect(mergeAcquiredRecords([record, { ...record, retrievedAtMs: now + 1 }])).toHaveLength(1);
    expect(() => mergeAcquiredRecords([record, { ...record, close: '106' }])).toThrow('Conflicting');
  });
  it('preserves each successful month before a later acquisition fails', async () => {
    const cfg = config(); const http = client();
    const original = http.getText;
    http.getText = vi.fn(async (url: string, init): Promise<HttpResult<string>> => url.includes('-2025-02')
      ? { ok: false, reason: 'http', retried: 0, status: 503 } : original(url, init));
    const partial = await acquireBinanceProduct({ config: cfg, http, retrievedAtMs: Date.UTC(2025, 2, 1), snapshots: [] },
      cfg.products[0]!, day, Date.UTC(2025, 2, 1));
    expect(partial.failure).toContain('503');
    expect(partial.records).toHaveLength(1);
    const resumed = await acquireBinanceProduct({ config: cfg, http, retrievedAtMs: now, snapshots: [] }, cfg.products[0]!, day, day + 86400000);
    expect(resumed.records).toHaveLength(1);
    expect(http.getBytes).toHaveBeenCalledTimes(1);
  });
  it('archives verified partial coverage while reporting the unresolved source failure', async () => {
    const cfg = config(); const http = client();
    const original = http.getText;
    http.getText = vi.fn(async (url: string, init): Promise<HttpResult<string>> => url.includes('-2025-02')
      ? { ok: false, reason: 'http', retried: 0, status: 503 } : original(url, init));
    const result = await runMarketAcquisition({ config: { ...cfg, endExclusiveMs: Date.UTC(2025, 2, 1) },
      http, codeRevision: 'partial-test', retrievedAtMs: Date.UTC(2025, 2, 2) });
    const item = result.report.instruments[0]!;
    expect(result.report.ok).toBe(false);
    expect(item.status).toBe('failed');
    expect(item.failure).toContain('503');
    expect(item.datasetHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(item.coverage.observedDayCount).toBe(1);
    expect(await queryMarketBarArchive(item.datasetDir!)).toHaveLength(1);
  });
  it('reports failed providers independently and excludes unfinished bars', async () => {
    const cfg = config(); const http = client();
    const original = http.getText;
    http.getText = vi.fn(async (url: string, init): Promise<HttpResult<string>> => url.includes('TERMS_AND_CONDITIONS')
      ? { ok: false, reason: 'network', status: 0, retried: 0 } : original(url, init));
    const result = await runMarketAcquisition({ config: cfg, http, codeRevision: 'test', retrievedAtMs: now });
    expect(result.report.ok).toBe(false);
    expect(result.report.instruments[0]?.datasetHash).toBeNull();
    expect(http.getBytes).not.toHaveBeenCalled();
    expect(parseMarketAcquisitionConfig({ schemaVersion: 1, products: cfg.products.map((p) => ({ ...p.instrument,
      baseAsset: p.baseAsset, quoteAsset: p.quoteAsset })) }, day + 1000).endExclusiveMs).toBe(day);
  });
});
