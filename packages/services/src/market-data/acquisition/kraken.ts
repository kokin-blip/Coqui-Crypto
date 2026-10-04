import { join } from 'node:path';
import {
  acquireKrakenRelease, discoverKrakenReleases, KRAKEN_ARCHIVE_DOCUMENTATION,
  type KrakenArchiveManifest,
} from '@coqui/adapters';
import { configurationHash, describeFile, preserveBundle, preserveEnvelope } from './artifacts.js';
import type { AcquisitionProduct } from './config.js';
import { cachedAcquisition, cachedSource, type AcquisitionContext, type ProviderAcquisition } from './providers.js';
import { normalizeAcquiredRecords } from './records.js';

export async function acquireKrakenProducts(context: AcquisitionContext, products: AcquisitionProduct[]): Promise<{
  products: Map<string, ProviderAcquisition>; releaseEndExclusiveMs: number;
}> {
  const documentation = await context.http.getText(KRAKEN_ARCHIVE_DOCUMENTATION);
  if (!documentation.ok) throw new Error(`Kraken release discovery failed: ${documentation.status}`);
  const checksumUrl = 'https://assets.kraken.com/marketing/institutions/OHLCVT_Full_PARTS_SHA256SUMS.txt';
  const checksum = await context.http.getText(checksumUrl);
  if (!checksum.ok) throw new Error(`Kraken checksum discovery failed: ${checksum.status}`);
  const directory = preserveBundle(join(context.config.sourceDir, 'snapshots'), {
    'kraken-release.html': documentation.data, 'kraken-parts.SHA256SUMS': checksum.data,
  });
  const releaseSnapshots = await Promise.all(['kraken-release.html', 'kraken-parts.SHA256SUMS']
    .map((name) => describeFile(join(directory, name))));
  const releases = discoverKrakenReleases(documentation.data, checksum.data);
  const acquired = new Map<string, ProviderAcquisition>(products.map((product) => [
    product.instrument.productId, { records: [], sources: [], envelopes: [], unavailable: [] },
  ]));
  let releaseEndExclusiveMs = 0;
  for (const release of releases) {
    if (release.origin === 'quarterly' && release.endExclusiveMs - 93 * 86_400_000 >= context.config.endExclusiveMs) continue;
    context.progress?.(`Kraken ${release.archiveName}: verified multipart download and daily extraction`);
    const prior = await Promise.all(products.map((product) => cachedAcquisition(context,
      `kraken-ohlcvt-archive:${release.archiveSha256}:${product.instrument.productId}`)));
    const downloaded = await acquireKrakenRelease(context.http, release,
      join(context.config.sourceDir, 'kraken'), products.map((product) => product.instrument.productId),
      context.retrievedAtMs, context.signal);
    const artifacts = await Promise.all(downloaded.paths.map(describeFile));
    const { stat } = await import('node:fs/promises');
    const capturedAtMs = Math.floor(Math.max(...await Promise.all(downloaded.paths.map(async (path) => (await stat(path)).mtimeMs))));
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index]!;
      const result = downloaded.results[index]!;
      const acquisition = acquired.get(product.instrument.productId)!;
      if (!result.ok) { acquisition.failure = `Kraken ${product.instrument.productId}: ${result.code}`; continue; }
      const previous = prior[index];
      const originalTime = previous?.envelope.retrievedAtMs ?? capturedAtMs;
      const sourceId = `kraken-ohlcvt-archive:${release.archiveSha256}:${product.instrument.productId}`;
      if (previous) {
        const manifest = previous.envelope.providerManifest as KrakenArchiveManifest;
        if (manifest.manifestHash !== result.manifest.manifestHash) throw new Error('Cached Kraken parsing differs.');
        acquisition.sources.push(cachedSource(previous.envelope)); acquisition.envelopes.push(previous.path);
      } else {
        const saved = preserveEnvelope(context.config.sourceDir, {
          sourceId, configurationHash: configurationHash(context.config), retrievedAtMs: originalTime,
          artifacts, snapshots: [...context.snapshots, ...releaseSnapshots],
          providerManifest: { ...result.manifest, retrievedAtMs: originalTime }, upstreamChecksums: { ...release.checksums,
            [release.archiveName]: release.archiveSha256 },
        });
        // Index by release digest: corrected upstream bytes always get a new identity.
        const { mkdirSync, writeFileSync, renameSync } = await import('node:fs');
        const { digest } = await import('./artifacts.js');
        const pointer = join(context.config.sourceDir, 'index', `${digest(sourceId)}.json`);
        mkdirSync(join(context.config.sourceDir, 'index'), { recursive: true });
        writeFileSync(`${pointer}.tmp`, JSON.stringify({ path: saved.path })); renameSync(`${pointer}.tmp`, pointer);
        acquisition.sources.push(saved.source); acquisition.envelopes.push(saved.path);
      }
      const start = context.config.startTimeMs ?? 0;
      acquisition.records.push(...normalizeAcquiredRecords(product, result.records, originalTime,
        start, Math.min(context.config.endExclusiveMs, release.endExclusiveMs)));
    }
    releaseEndExclusiveMs = Math.max(releaseEndExclusiveMs, release.endExclusiveMs);
  }
  return { products: acquired, releaseEndExclusiveMs };
}
