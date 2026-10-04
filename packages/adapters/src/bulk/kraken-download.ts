import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { downloadVerifiedFile, type HttpClient } from '../http/index.js';
import { createKrakenDailyArchiveImporter, type KrakenArchiveImportResult } from './kraken.js';

export const KRAKEN_ARCHIVE_DOCUMENTATION =
  'https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data';
const HOST = 'https://assets.kraken.com/marketing/institutions/';
export interface KrakenRelease {
  archiveName: string;
  origin: 'complete' | 'quarterly';
  endExclusiveMs: number;
  urls: string[];
  checksums: Record<string, string>;
  archiveSha256: string;
}
/** Only official, constrained archive links and published SHA-256s are accepted. */
export function discoverKrakenReleases(documentation: string, checksumText: string): KrakenRelease[] {
  const decoded = documentation.replaceAll('\\/', '/').replaceAll('&amp;', '&');
  const names = [...new Set(decoded.match(/Kraken_OHLCVT_(?:Full_)?\d{4}Q[1-4]\.zip(?:\.part\d{2})?/gu) ?? [])];
  const fullNames = names.filter((name) => name.includes('_Full_'));
  const latest = fullNames.map((name) => name.replace(/\.part\d{2}$/u, '')).sort().at(-1);
  if (!latest) throw new Error('No official Kraken full release was found.');
  const checksums: Record<string, string> = {};
  for (const line of checksumText.trim().split(/\r?\n/u)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(Kraken_OHLCVT_[A-Za-z0-9_.]+)$/u.exec(line.trim());
    if (match) {
      if (checksums[match[2]!] && checksums[match[2]!] !== match[1]!.toLowerCase()) {
        throw new Error('Conflicting Kraken published checksum.');
      }
      checksums[match[2]!] = match[1]!.toLowerCase();
    }
  }
  const releases = [...new Set(names.map((name) => name.replace(/\.part\d{2}$/u, '')))]
    .filter((name) => name === latest || (!name.includes('_Full_') && name.slice(14) > latest.slice(19)));
  return releases.sort().map((archiveName) => {
    const period = /(\d{4})Q([1-4])/u.exec(archiveName)!;
    const parts = names.filter((name) => name.startsWith(`${archiveName}.part`)).sort();
    const files = parts.length > 0 ? parts : [archiveName];
    if (parts.some((name, index) => !name.endsWith(`part${String(index).padStart(2, '0')}`))) {
      throw new Error('Kraken multipart sequence is incomplete.');
    }
    const nearby = decoded.slice(decoded.indexOf(archiveName), decoded.indexOf(archiveName) + 10000).replace(/<[^>]*>/gu, ' ');
    const assembled = checksums[archiveName] ?? (archiveName === latest
      ? /expected[^a-f0-9]*([a-f0-9]{64})/iu.exec(nearby)?.[1]?.toLowerCase() : undefined);
    if (!assembled || files.some((name) => !checksums[name] && name !== archiveName)) {
      throw new Error('Missing published Kraken archive or part checksum.');
    }
    return { archiveName, origin: archiveName.includes('_Full_') ? 'complete' as const : 'quarterly' as const,
      endExclusiveMs: Date.UTC(Number(period[1]), Number(period[2]) * 3, 1),
      urls: files.map((name) => `${HOST}${name}`), checksums,
      archiveSha256: assembled };
  });
}

/** Preserve parts once, then hash and parse their concatenation without an assembled copy. */
export async function acquireKrakenRelease(http: HttpClient, release: KrakenRelease,
  root: string, pairs: readonly string[], retrievedAtMs: number, signal?: AbortSignal): Promise<{
    paths: string[]; results: KrakenArchiveImportResult[];
  }> {
  const paths: string[] = [];
  for (const url of release.urls) {
    const name = url.slice(url.lastIndexOf('/') + 1);
    const path = join(root, release.archiveSha256, name);
    await downloadVerifiedFile(http, { url, path,
      sha256: release.checksums[name] ?? release.archiveSha256, ...(signal ? { signal } : {}) });
    paths.push(path);
  }
  const hash = createHash('sha256');
  const importers = pairs.map((pair) => createKrakenDailyArchiveImporter({
    pair, archiveName: release.archiveName, origin: release.origin, retrievedAtMs, upstreamChecksumAvailable: true,
  }));
  for (const path of paths) {
    for await (const chunk of createReadStream(path, { highWaterMark: 256 * 1024 })) {
      if (signal?.aborted) throw new Error('Kraken acquisition canceled.');
      hash.update(chunk);
      for (const importer of importers) importer.push(chunk);
    }
  }
  if (hash.digest('hex') !== release.archiveSha256) throw new Error('Kraken assembled checksum mismatch.');
  for (const importer of importers) importer.push(new Uint8Array(), true);
  return { paths, results: importers.map((importer) => importer.finish()) };
}
