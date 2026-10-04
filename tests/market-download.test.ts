import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertDownloadSpace, createHttpClient, downloadVerifiedFile, type FetchLike,
} from '../packages/adapters/src/index.js';
import { hash } from './market-acquisition-fixtures.js';

const roots: string[] = [];
function destination(): string {
  const root = mkdtempSync(join(tmpdir(), 'coqui-download-')); roots.push(root); return join(root, 'file.zip');
}
const url = 'https://assets.kraken.com/archive.zip';
const bytes = new TextEncoder().encode('verified immutable public archive');
const request = (path: string) => ({ url, path, sha256: hash(bytes) });
const client = (fetch: FetchLike) => createHttpClient({ fetch, maxRetries: 0, maxElapsedMs: 1000 });
function partial(path: string, validator = '"old"') {
  writeFileSync(`${path}.partial`, bytes.slice(0, 10));
  writeFileSync(`${path}.partial.json`, JSON.stringify({ url, validator, total: bytes.length }));
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('streaming verified downloads', () => {
  it('verifies and reuses immutable files without another request', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(bytes, { headers: { 'content-length': String(bytes.length), etag: '"v1"' } }));
    const http = client(fetch); const path = destination();
    try {
      await downloadVerifiedFile(http, request(path)); await downloadVerifiedFile(http, request(path));
      expect(fetch).toHaveBeenCalledTimes(1); expect(readFileSync(path)).toEqual(Buffer.from(bytes));
      writeFileSync(path, 'tampered'); await expect(downloadVerifiedFile(http, request(path))).rejects.toThrow('differs');
    } finally { http.destroy(); }
  });
  it('resumes only a matching validator and exact byte range', async () => {
    const path = destination(); partial(path);
    const fetch = vi.fn<FetchLike>(async (_url, init) => {
      expect(new Headers(init?.headers).get('range')).toBe('bytes=10-');
      expect(new Headers(init?.headers).get('if-range')).toBe('"old"');
      return new Response(bytes.slice(10), { status: 206, headers: { etag: '"old"',
        'content-length': String(bytes.length - 10), 'content-range': `bytes 10-${bytes.length - 1}/${bytes.length}` } });
    });
    const http = client(fetch);
    try { await downloadVerifiedFile(http, request(path)); expect(readFileSync(path)).toEqual(Buffer.from(bytes)); }
    finally { http.destroy(); }
  });
  it('restarts when Range is ignored, and never appends a changed remote object', async () => {
    const path = destination(); partial(path);
    const http = client(async () => new Response(bytes, { headers: { etag: '"new"', 'content-length': String(bytes.length) } }));
    try { await downloadVerifiedFile(http, request(path)); expect(readFileSync(path)).toEqual(Buffer.from(bytes)); }
    finally { http.destroy(); }
    const second = destination(); partial(second);
    const fetch = vi.fn<FetchLike>().mockImplementationOnce(async () => new Response(bytes.slice(10), {
      status: 206, headers: { etag: '"changed"', 'content-length': String(bytes.length - 10),
        'content-range': `bytes 10-${bytes.length - 1}/${bytes.length}` },
    })).mockImplementationOnce(async (_url, init) => {
      expect(new Headers(init?.headers).get('range')).toBeNull();
      return new Response(bytes, { headers: { etag: '"new"', 'content-length': String(bytes.length) } });
    });
    const restarted = client(fetch);
    try { await downloadVerifiedFile(restarted, request(second)); expect(fetch).toHaveBeenCalledTimes(2); }
    finally { restarted.destroy(); }
  });
  it('retains interrupted bytes and resumes them on the next invocation', async () => {
    const path = destination();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulls++ === 0) controller.enqueue(bytes.slice(0, 10)); else controller.error(new Error('interrupted'));
    } });
    const interrupted = client(async () => new Response(body, { headers: { etag: '"old"', 'content-length': String(bytes.length) } }));
    try { await expect(downloadVerifiedFile(interrupted, request(path))).rejects.toThrow('Download failed'); }
    finally { interrupted.destroy(); }
    expect(readFileSync(`${path}.partial`)).toEqual(Buffer.from(bytes.slice(0, 10)));
    const resumed = client(async () => new Response(bytes.slice(10), { status: 206, headers: { etag: '"old"',
      'content-length': String(bytes.length - 10), 'content-range': `bytes 10-${bytes.length - 1}/${bytes.length}` } }));
    try { await downloadVerifiedFile(resumed, request(path)); } finally { resumed.destroy(); }
  });
  it('rejects wrong checksums, truncation, cancellation and insufficient space', async () => {
    const http = client(async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }));
    try {
      await expect(downloadVerifiedFile(http, { ...request(destination()), sha256: '0'.repeat(64) })).rejects.toThrow('checksum');
      const controller = new AbortController(); controller.abort();
      await expect(downloadVerifiedFile(http, { ...request(destination()), signal: controller.signal })).rejects.toThrow('canceled');
    } finally { http.destroy(); }
    const truncated = client(async () => new Response(bytes.slice(0, 5), { headers: { 'content-length': String(bytes.length) } }));
    try { await expect(downloadVerifiedFile(truncated, request(destination()))).rejects.toThrow('Download failed'); }
    finally { truncated.destroy(); }
    expect(() => assertDownloadSpace(10n, 11n)).toThrow('space');
  });
});
