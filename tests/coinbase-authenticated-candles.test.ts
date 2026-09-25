import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createCoinbaseReadHttpClient, createMemorySecretStore, createRateLimiterRegistry, writeConnectionSecret,
  fetchAuthenticatedCoinbaseDailyBars, fetchAuthenticatedCoinbaseDisplayBars,
  type CoinbaseReadHttpClient, type HttpClient, type HttpResult,
} from '../packages/adapters/src/index.js';
import { profileConnectionV2, sha256Hex, type InstrumentIdentity } from '../packages/core/src/index.js';
import { parallelAnchor, parallelDecision, syncCoinbaseDecisionDataset } from '../packages/services/src/index.js';
import { openDatabase, saveProfileConnectionV2 } from '../packages/storage/src/index.js';
import { createHistoricalCoinbaseCandleSource } from '../apps/desktop/src/main/coinbase-candle-source.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 25, 0, 6);
const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };

function row(start: number) {
  return { start: String(start / 1_000), open: '100', high: '110', low: '90',
    close: '105', volume: '20.5' };
}

function auth(getJson: CoinbaseReadHttpClient['getJson']): CoinbaseReadHttpClient {
  return { getJson, destroy: vi.fn() };
}

function publicHttp(getJson: HttpClient['getJson']): HttpClient {
  const unavailable = async <T>(): Promise<HttpResult<T>> =>
    ({ ok: false, status: 501, reason: 'http', retried: 0 });
  return { getJson, postJson: unavailable, getText: unavailable, destroy: () => {} };
}

describe('authenticated Coinbase candles', () => {
  it('backfills 121 completed daily bars for each TrendVol product with signed-client URLs', async () => {
    for (const productId of ['BTC-USD', 'ETH-USD', 'LTC-USD']) {
      const urls: string[] = [];
      const client = auth(async <T>(url: string) => {
        urls.push(url);
        const params = new URL(url).searchParams;
        const start = Number(params.get('start')) * 1_000;
        const end = Number(params.get('end')) * 1_000;
        const candles = [];
        for (let at = start; at < end; at += DAY) candles.push(row(at));
        return { ok: true, status: 200, data: { candles } as T };
      });
      const instrument = { ...BTC, productId };
      const result = await fetchAuthenticatedCoinbaseDailyBars(client, instrument,
        { maxDays: 121, nowMs: NOW });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.data.filter((bar) => bar.isComplete)).toHaveLength(121);
      expect(result.data.at(-1)?.isComplete).toBe(false);
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain(`/products/${productId}/candles?`);
      expect(new URL(urls[0]!).searchParams.get('granularity')).toBe('ONE_DAY');
    }
  });

  it('pages a 400-day backfill and rejects malformed pages as a unit', async () => {
    let pages = 0;
    const client = auth(async <T>(url: string) => {
      pages += 1;
      const params = new URL(url).searchParams;
      const start = Number(params.get('start')) * 1_000;
      const end = Number(params.get('end')) * 1_000;
      const candles = [];
      for (let at = start; at < end; at += DAY) candles.push(row(at));
      return { ok: true, status: 200, data: { candles } as T };
    });
    const result = await fetchAuthenticatedCoinbaseDailyBars(client, BTC, { maxDays: 400, nowMs: NOW });
    expect(result.ok && result.data.filter((bar) => bar.isComplete).length).toBe(400);
    expect(pages).toBe(2);
    const malformed = await fetchAuthenticatedCoinbaseDailyBars(auth(async <T>() =>
      ({ ok: true, status: 200, data: { candles: [{ ...row(NOW - DAY), high: '95' }] } as T })),
    BTC, { maxDays: 1, nowMs: NOW });
    expect(malformed).toMatchObject({ ok: false, reason: 'parse' });
  });

  it('feeds a 121-day aligned authenticated dataset into TrendVol', async () => {
    const database = openDatabase(':memory:');
    const client = auth(async <T>(url: string) => {
      const params = new URL(url).searchParams;
      const start = Number(params.get('start')) * 1_000;
      const end = Number(params.get('end')) * 1_000;
      const candles = [];
      for (let at = start; at < end; at += DAY) candles.push(row(at));
      return { ok: true, status: 200, data: { candles } as T };
    });
    const instruments = ['BTC-USD', 'ETH-USD', 'LTC-USD'].map((productId) => ({ ...BTC, productId }));
    const result = await syncCoinbaseDecisionDataset({ database, instruments,
      maxDays: 121, minAlignedDays: 121, nowMs: NOW,
      fetchDailyBars: (instrument, options) => fetchAuthenticatedCoinbaseDailyBars(client, instrument, options) });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataset.dayKeys).toHaveLength(121);
      expect(parallelDecision(result.dataset, parallelAnchor(result.dataset)).day)
        .toBe('2026-09-24');
    }
    database.close();
  });

  it('maps every historical chart interval and omits unfinished buckets', async () => {
    const intervals = { '1m': 'ONE_MINUTE', '5m': 'FIVE_MINUTE', '15m': 'FIFTEEN_MINUTE',
      '1h': 'ONE_HOUR', '6h': 'SIX_HOUR', '1d': 'ONE_DAY' } as const;
    for (const [interval, name] of Object.entries(intervals)) {
      const ms = { '1m': 60_000, '5m': 300_000, '15m': 900_000,
        '1h': 3_600_000, '6h': 21_600_000, '1d': DAY }[interval as keyof typeof intervals];
      const start = Math.floor((NOW - ms) / ms) * ms;
      const client = auth(async <T>(url: string) => {
        expect(new URL(url).searchParams.get('granularity')).toBe(name);
        return { ok: true, status: 200, data: { candles: [row(start)] } as T };
      });
      const result = await fetchAuthenticatedCoinbaseDisplayBars(client, BTC,
        { interval: interval as keyof typeof intervals, startTimeMs: start,
          endTimeMs: start + ms, nowMs: start + ms - 1 });
      expect(result).toMatchObject({ ok: true, data: [] });
    }
  });

  it('signs the exact Advanced Trade candle path with the stored view-only key', async () => {
    const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const urls: string[] = [], authorizations: string[] = [];
    const client = createCoinbaseReadHttpClient({ keyName: 'organizations/example/apiKeys/view',
      privateKey: key.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string }, {
      maxRetries: 0,
      fetch: async (url, init) => {
        urls.push(url);
        authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
        return { ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ candles: [row(NOW - DAY - 6 * 60_000)] }), text: async () => '' };
      },
    });
    try {
      const result = await fetchAuthenticatedCoinbaseDailyBars(client, BTC, { maxDays: 1, nowMs: NOW });
      expect(result.ok).toBe(true);
      expect(urls[0]).toContain('/api/v3/brokerage/products/BTC-USD/candles?');
      const claims = JSON.parse(Buffer.from(authorizations[0]!.slice(7).split('.')[1]!, 'base64url').toString()) as { uri: string };
      expect(claims.uri).toBe('GET api.coinbase.com/api/v3/brokerage/products/BTC-USD/candles');
    } finally { client.destroy(); }
  });

  it('uses the public source without a connected key', async () => {
    const database = openDatabase(':memory:');
    let calls = 0;
    const source = createHistoricalCoinbaseCandleSource({ database, profileId: 'main',
      publicHttp: publicHttp(async <T>(): Promise<HttpResult<T>> => {
        calls += 1;
        return { ok: true, status: 200, data: [] as T };
      }), rateLimiters: createRateLimiterRegistry(), nowMs: () => NOW });
    const result = await source.dailyBars(BTC, 2, NOW);
    expect(result.ok).toBe(true);
    expect(calls).toBeGreaterThan(0);
    database.close();
  });

  it('uses an active stored view-only key, then falls back after an authenticated failure', async () => {
    const database = openDatabase(':memory:');
    const secrets = createMemorySecretStore();
    const key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const credentials = { keyName: 'organizations/example/apiKeys/view',
      privateKey: key.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string };
    const connection = profileConnectionV2('main', 'coinbase', sha256Hex(credentials.keyName), NOW);
    saveProfileConnectionV2(connection, database);
    await writeConnectionSecret(secrets, { profileId: 'main', connectionId: connection.id,
      provider: 'coinbase', credentialType: 'api_credentials', schemaVersion: 2 }, JSON.stringify(credentials));
    const sourceEvents: string[] = [];
    let publicCalls = 0;
    const publicGet = async <T>(): Promise<HttpResult<T>> => {
      publicCalls += 1;
      return { ok: true, status: 200,
        data: [[(NOW - DAY - 6 * 60_000) / 1_000, 90, 110, 100, 105, 20]] as T };
    };
    const authorized = vi.fn(async () => ({ ok: false as const, status: 503,
      reason: 'http' as const, retried: 0 }));
    const source = createHistoricalCoinbaseCandleSource({ database, profileId: 'main',
      publicHttp: publicHttp(publicGet), secrets, rateLimiters: createRateLimiterRegistry(), nowMs: () => NOW,
      clientFactory: () => auth(authorized),
      onSource: (route) => sourceEvents.push(route) });
    const result = await source.dailyBars(BTC, 2, NOW);
    expect(result.ok).toBe(true);
    expect(authorized).toHaveBeenCalledOnce();
    expect(publicCalls).toBeGreaterThan(0);
    expect(sourceEvents).toEqual(['public']);
    const display = await source.displayBars(BTC, '1d', NOW - DAY - 6 * 60_000,
      NOW - 6 * 60_000, NOW);
    expect(display.ok && display.bars).toHaveLength(1);
    expect(sourceEvents).toEqual(['public', 'public']);
    database.close();
  });
});
