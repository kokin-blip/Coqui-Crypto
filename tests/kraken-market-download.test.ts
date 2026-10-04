import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireKrakenRelease, createHttpClient, createKrakenDailyArchiveImporter, discoverKrakenReleases,
} from '../packages/adapters/src/index.js';
import { fixtureZip, hash } from './market-acquisition-fixtures.js';

const roots: string[] = [];
const day = Date.UTC(2025, 0, 1);
const row = `${day / 1000},100.00000001,110.00,90.00,105.00,12.50000,42\n`;
function releaseFixture() {
  const bytes = fixtureZip({ 'OTHER_1.csv': 'unselected'.repeat(1000), 'XBTUSD_1440.csv': row }, true, true);
  const split = Math.floor(bytes.length / 2);
  const parts = [bytes.slice(0, split), bytes.slice(split)];
  const name = 'Kraken_OHLCVT_Full_2025Q1.zip';
  const docs = `${name}.part00 ${name}.part01\n# expected: ${hash(bytes)}`;
  const checksums = parts.map((part, i) => `${hash(part)}  ${name}.part0${i}`).join('\n');
  return { bytes, parts, docs, checksums, release: discoverKrakenReleases(docs, checksums)[0]! };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('Kraken current full-history acquisition', () => {
  it('discovers ordered parts, published checksums and release cutoff', () => {
    const fixture = releaseFixture();
    expect(fixture.release.urls).toHaveLength(2);
    expect(fixture.release.endExclusiveMs).toBe(Date.UTC(2025, 3, 1));
    expect(() => discoverKrakenReleases(fixture.docs.replace('part01', 'part02'), fixture.checksums)).toThrow('sequence');
    expect(() => discoverKrakenReleases(fixture.docs, '')).toThrow('checksum');
  });
  it('streams ZIP64 daily selection while draining irrelevant compressed entries', () => {
    const fixture = releaseFixture();
    const importer = createKrakenDailyArchiveImporter({ pair: 'XBTUSD', archiveName: fixture.release.archiveName,
      origin: 'complete', retrievedAtMs: day + 86400000 });
    for (let offset = 0; offset < fixture.bytes.length; offset += 13) importer.push(fixture.bytes.slice(offset, offset + 13));
    importer.push(new Uint8Array(), true);
    const result = importer.finish();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records[0]?.open).toBe('100.00000001');
  });
  it('expands scientific-notation volumes from current official history exactly', () => {
    const csv = '1409616000,524.76939,524.76939,524.76939,524.76939,3.811e-05,1\n';
    const importer = createKrakenDailyArchiveImporter({ pair: 'XBTUSD', archiveName: 'Kraken_OHLCVT.zip',
      origin: 'complete', retrievedAtMs: day });
    importer.push(fixtureZip({ 'XBTUSD_1440.csv': csv }), true);
    const result = importer.finish();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.records[0]?.volume).toBe('0.00003811');
  });
  it('verifies both parts and their concatenation without creating an assembled copy', async () => {
    const fixture = releaseFixture();
    const root = mkdtempSync(join(tmpdir(), 'coqui-kraken-download-')); roots.push(root);
    const http = createHttpClient({ fetch: async (url) => {
      const part = fixture.parts[url.endsWith('part00') ? 0 : 1]!;
      return new Response(part, { headers: { 'content-length': String(part.length), etag: '"v1"' } });
    }, maxRetries: 0 });
    try {
      const result = await acquireKrakenRelease(http, fixture.release, root, ['XBTUSD'], day + 86400000);
      expect(result.paths).toHaveLength(2); expect(result.results[0]?.ok).toBe(true);
      const wrong = { ...fixture.release, archiveSha256: '0'.repeat(64) };
      await expect(acquireKrakenRelease(http, wrong, root, ['XBTUSD'], day + 86400000)).rejects.toThrow('assembled checksum');
      const reordered = { ...fixture.release, urls: [...fixture.release.urls].reverse() };
      await expect(acquireKrakenRelease(http, reordered, root, ['XBTUSD'], day + 86400000)).rejects.toThrow('assembled checksum');
    } finally { http.destroy(); }
  });
});
