import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, statfs, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HttpClient } from './client.js';

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function assertDownloadSpace(available: bigint, remaining: bigint): void {
  if (remaining < 0n || available < remaining + 256n * 1024n * 1024n) {
    throw new Error('Insufficient disk space for the remaining download and safety reserve.');
  }
}

interface PartialMetadata { url: string; validator: string | null; total: number }

/** Download immutable bytes with bounded memory and validated HTTP range resumption. */
export async function downloadVerifiedFile(http: HttpClient, request: {
  url: string; path: string; sha256: string; signal?: AbortSignal;
}): Promise<{ sha256: string; byteLength: number }> {
  if (!/^[a-f0-9]{64}$/u.test(request.sha256) || !http.consumeStream) {
    throw new TypeError('A SHA-256 and streaming HTTP client are required.');
  }
  if (new URL(request.url).protocol !== 'https:') throw new TypeError('HTTPS is required.');
  await mkdir(dirname(request.path), { recursive: true });
  try {
    const existing = await stat(request.path);
    if (await sha256File(request.path) !== request.sha256) throw new Error('Immutable download differs.');
    return { sha256: request.sha256, byteLength: existing.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const partial = `${request.path}.partial`;
  const metadataPath = `${partial}.json`;
  let offset = 0;
  let metadata: PartialMetadata | null = null;
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as PartialMetadata;
    offset = (await stat(partial)).size;
    if (metadata.url !== request.url || !Number.isSafeInteger(metadata.total) ||
        metadata.total < offset || !metadata.validator || offset === metadata.total) offset = 0;
  } catch { offset = 0; }
  const headers: Record<string, string> = { 'accept-encoding': 'identity' };
  if (offset > 0 && metadata?.validator) {
    headers['range'] = `bytes=${offset}-`;
    headers['if-range'] = metadata.validator;
  }
  const result = await http.consumeStream(request.url, async (response) => {
    const validator = response.headers.get('etag') ?? response.headers.get('last-modified');
    const lengthText = response.headers.get('content-length');
    if (lengthText === null || !/^\d+$/u.test(lengthText)) throw new Error('Missing download length.');
    const length = Number(lengthText);
    let total = length;
    let append = false;
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get('content-range') ?? '');
      if (offset === 0 || !range || Number(range[1]) !== offset ||
          Number(range[2]) - offset + 1 !== length || Number(range[2]) + 1 !== Number(range[3]) ||
          validator !== metadata?.validator || Number(range[3]) !== metadata.total) {
        throw new Error('Invalid or changed range response.');
      }
      total = Number(range[3]);
      append = true;
    } else if (response.status !== 200) throw new Error('Unexpected download status.');
    if (!Number.isSafeInteger(total) || total <= 0 || !response.body) {
      throw new Error('Invalid download size or missing streaming body.');
    }
    const disk = await statfs(dirname(request.path), { bigint: true });
    assertDownloadSpace(disk.bavail * disk.bsize, BigInt(length));
    await writeFile(metadataPath, JSON.stringify({ url: request.url, validator, total }));
    const file = await open(partial, append ? 'a' : 'w');
    const reader = response.body.getReader();
    const cancelReader = (): void => { void reader.cancel().catch(() => {}); };
    request.signal?.addEventListener('abort', cancelReader, { once: true });
    let received = append ? offset : 0;
    try {
      while (true) {
        if (request.signal?.aborted) throw new Error('Download canceled.');
        const next = await reader.read();
        if (next.done) break;
        received += next.value.byteLength;
        if (received > total) throw new Error('Download exceeded declared size.');
        let written = 0;
        while (written < next.value.length) {
          written += (await file.write(next.value, written, next.value.length - written)).bytesWritten;
        }
      }
      if (received !== total) throw new Error('Truncated download.');
      await file.sync();
    } finally {
      request.signal?.removeEventListener('abort', cancelReader);
      await reader.cancel().catch(() => {});
      await file.close();
    }
    return received;
  }, { headers, maxElapsedMs: 24 * 60 * 60_000,
    ...(request.signal ? { signal: request.signal } : {}) });
  if (!result.ok) {
    if (offset > 0 && (result.reason === 'parse' || result.status === 416) && !request.signal?.aborted) {
      // A stale validator or invalid range must restart, never append to another object.
      await unlink(metadataPath);
      return downloadVerifiedFile(http, request);
    }
    throw new Error(`Download failed: ${result.reason}:${result.status}`);
  }
  if (await sha256File(partial) !== request.sha256) throw new Error('Downloaded checksum mismatch.');
  await rename(partial, request.path);
  return { sha256: request.sha256, byteLength: result.data };
}
