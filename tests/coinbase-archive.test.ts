import { createHash } from 'node:crypto';

import {
  downloadCoinbaseDailyArchive,
  verifyCoinbaseDailyArchiveArtifact,
  type HttpClient,
  type HttpResult,
} from '../packages/adapters/src/index.js';
import { describe, expect, it } from 'vitest';

const DAY_MS = 86_400_000;
const start = Date.UTC(2024, 0, 1);
const instrument = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' } as const;

function client(handler: (url: string) => HttpResult<string> | Promise<HttpResult<string>>): HttpClient {
  const unavailable = async <T>(): Promise<HttpResult<T>> => ({
    ok: false, status: 501, reason: 'http', retried: 0,
  });
  return {
    getJson: unavailable,
    postJson: unavailable,
    getText: async (url) => await handler(url),
    destroy: () => {},
  };
}

function request(days: number) {
  return {
    instrument,
    startTimeMs: start,
    endExclusiveMs: start + days * DAY_MS,
    retrievedAtMs: start + days * DAY_MS + 300_000,
  } as const;
}

describe('Coinbase exact daily archive acquisition', () => {
  it('preserves exact decimal text and hashes the raw paginated responses', async () => {
    let calls = 0;
    const http = client((url) => {
      calls += 1;
      const parsed = new URL(url);
      const pageStart = Date.parse(parsed.searchParams.get('start')!);
      const pageEnd = Date.parse(parsed.searchParams.get('end')!);
      const rows: string[] = [];
      for (let time = pageEnd - DAY_MS; time >= pageStart; time -= DAY_MS) {
        rows.push(`[${time / 1_000},90.000000000000000003,110.000000000000000002,` +
          `100.000000000000000001,105.123456789123456789,12.500000000000000001]`);
      }
      return { ok: true, status: 200, data: `[${rows.join(',')}]` };
    });

    const result = await downloadCoinbaseDailyArchive(http, request(301));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls).toBe(2);
    expect(result.records).toHaveLength(301);
    expect(result.records[0]).toMatchObject({
      open: '100.000000000000000001',
      close: '105.123456789123456789',
      volume: '12.500000000000000001',
    });
    expect(result.manifest.archiveSha256).toBe(
      createHash('sha256').update(result.rawArtifactText).digest('hex'),
    );
    expect(result.manifest.pages).toHaveLength(2);
    expect(result.manifest.recordCount).toBe(301);
    expect(verifyCoinbaseDailyArchiveArtifact(
      result.manifest, result.rawArtifactText,
    )).toEqual(result.records);
    expect(() => verifyCoinbaseDailyArchiveArtifact(
      result.manifest, `${result.rawArtifactText} `,
    )).toThrow('raw-content verification');
  });

  it('accepts scientific notation without binary-float conversion', async () => {
    const body = `[[${start / 1_000},9e1,1.1e2,1e2,1.05e2,1.25e1]]`;
    const result = await downloadCoinbaseDailyArchive(
      client(() => ({ ok: true, status: 200, data: body })),
      request(1),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records[0]).toMatchObject({
      low: '90', high: '110', open: '100', close: '105', volume: '12.5',
    });
  });

  it('fails closed on malformed responses and transport errors', async () => {
    await expect(downloadCoinbaseDailyArchive(
      client(() => ({ ok: true, status: 200, data: '[[broken]]' })), request(1),
    )).resolves.toEqual({ ok: false, code: 'invalid_response', status: 200 });

    await expect(downloadCoinbaseDailyArchive(
      client(() => ({ ok: false, status: 429, reason: 'http', retried: 3 })), request(1),
    )).resolves.toEqual({ ok: false, code: 'request_failed', status: 429 });
  });

  it('rejects non-Coinbase identities and unfinished end boundaries', async () => {
    const http = client(() => ({ ok: true, status: 200, data: '[]' }));
    await expect(downloadCoinbaseDailyArchive(http, {
      ...request(1),
      instrument: { venue: 'kraken', productId: 'XBTUSD', productType: 'spot' },
    })).rejects.toThrow('Coinbase spot');
    await expect(downloadCoinbaseDailyArchive(http, {
      ...request(1), retrievedAtMs: start + DAY_MS,
    })).rejects.toThrow('final bar completed');
  });
});
