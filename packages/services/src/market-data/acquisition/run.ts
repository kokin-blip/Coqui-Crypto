import { join } from 'node:path';
import type { HttpClient } from '@coqui/adapters';
import { verifyMarketBarArchive, writeMarketBarArchive, type ArchiveSourceArtifact, type MarketBarRecord } from '@coqui/storage';
import { describeFile, digest, preserveBundle, type RawArtifact } from './artifacts.js';
import { type AcquisitionProduct, type MarketAcquisitionConfig } from './config.js';
import { acquireBinanceProduct, acquireCoinbaseProduct, type AcquisitionContext, type ProviderAcquisition } from './providers.js';
import { acquireKrakenProducts } from './kraken.js';
import { coverageOf, mergeAcquiredRecords } from './records.js';

const SNAPSHOTS = {
  binance: [
    'https://raw.githubusercontent.com/binance/binance-public-data/master/README.md',
    'https://raw.githubusercontent.com/binance/binance-public-data/master/TERMS_AND_CONDITIONS.md',
  ],
  coinbase: [
    'https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles',
    'https://www.coinbase.com/legal/market_data',
  ],
  kraken: [
    'https://support.kraken.com/articles/360047124832-downloadable-historical-ohlcvt-open-high-low-close-volume-trades-data',
    'https://www.kraken.com/legal',
  ],
};
export interface AcquisitionInstrumentReport {
  product: AcquisitionProduct;
  requestedStartTimeMs: number;
  requestedEndExclusiveMs: number;
  status: 'verified' | 'failed';
  failure: string | null;
  datasetHash: string | null;
  manifestHash: string | null;
  datasetDir: string | null;
  envelopePaths: string[];
  unavailablePeriods: string[];
  coverage: ReturnType<typeof coverageOf>;
  missingnessMeaning: string;
  publishedReleaseEndExclusiveMs: number | null;
}
export interface MarketAcquisitionReport {
  schemaVersion: 1;
  ok: boolean;
  retrievedAtMs: number;
  codeRevision: string;
  config: MarketAcquisitionConfig;
  instruments: AcquisitionInstrumentReport[];
  reportHash: string;
}
async function snapshotVenue(context: AcquisitionContext, venue: AcquisitionProduct['instrument']['venue']): Promise<RawArtifact[]> {
  const snapshots: RawArtifact[] = [];
  for (const [index, url] of SNAPSHOTS[venue].entries()) {
    const result = await context.http.getText(url);
    if (!result.ok) throw new Error(`Source snapshot failed: ${venue}:${result.status}:${url}`);
    const directory = preserveBundle(join(context.config.sourceDir, 'snapshots'), {
      [`${venue}-${index}.txt`]: result.data,
      [`${venue}-${index}.metadata.json`]: JSON.stringify({ url, retrievedAtMs: context.retrievedAtMs }),
    });
    snapshots.push(await describeFile(join(directory, `${venue}-${index}.txt`)),
      await describeFile(join(directory, `${venue}-${index}.metadata.json`)));
  }
  return snapshots;
}
export function renderMarketAcquisitionReport(report: MarketAcquisitionReport): string {
  const date = (time: number | null): string => time === null ? '—' : new Date(time).toISOString().slice(0, 10);
  const lines = [ '# Market acquisition report', '',
    `Status: **${report.ok ? 'complete' : 'incomplete'}**`, '',
    `Captured: ${new Date(report.retrievedAtMs).toISOString()}; code: ${report.codeRevision}`, '',
    '| Venue | Product | Quote | Status | Daily rows | First observation | Observed end (exclusive) |',
    '|---|---|---|---|---:|---|---|',
    ...report.instruments.map((item) => `| ${item.product.instrument.venue} | ${item.product.instrument.productId} | ` +
      `${item.product.quoteAsset} | ${item.status} | ${item.coverage.observedDayCount} | ` +
      `${date(item.coverage.firstStartTimeMs)} | ${date(item.coverage.endExclusiveMs)} |`), '', ];
  for (const item of report.instruments) {
    lines.push(`## ${item.product.instrument.venue} ${item.product.instrument.productId}`, '',
      `Requested: ${date(item.requestedStartTimeMs)} to ${date(item.requestedEndExclusiveMs)} (exclusive).`, '',
      `Dataset: ${item.datasetHash ?? 'unavailable'}`, '',
      `Manifest: ${item.manifestHash ?? 'unavailable'}`, '',
      `Coverage interpretation: ${item.missingnessMeaning}`, '',
      `Unavailable provider files: ${item.unavailablePeriods.length}. See JSON for the complete list.`, '',
      `Published release cutoff: ${date(item.publishedReleaseEndExclusiveMs)}.`, '');
    if (item.failure) lines.push(`Failure: ${item.failure}`, '');
    for (const gap of item.coverage.missingRanges) {
      lines.push(`- Unobserved: ${date(gap.startTimeMs)} to ${date(gap.endExclusiveMs)} (exclusive).`);
    }
    lines.push('');
  }
  lines.push('Venue and quote identities remain separate. Observations do not establish historical listing eligibility.', '',
    `Report hash: ${report.reportHash}`, '');
  return lines.join('\n');
}
/** Research-only acquisition; deliberately never reads or writes operational SQLite. */
export async function runMarketAcquisition(request: {
  config: MarketAcquisitionConfig; http: HttpClient; codeRevision: string; retrievedAtMs: number;
  signal?: AbortSignal; progress?: (message: string) => void;
}): Promise<{ report: MarketAcquisitionReport; directory: string }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/+-]{0,199}$/u.test(request.codeRevision)) {
    throw new TypeError('An explicit safe code revision or working-tree label is required.');
  }
  const context: AcquisitionContext = { ...request, snapshots: [] };
  const instruments: AcquisitionInstrumentReport[] = [];
  const snapshots = new Map<string, RawArtifact[]>();
  const snapshotErrors = new Map<string, string>();
  let kraken: Awaited<ReturnType<typeof acquireKrakenProducts>> | null = null;
  let krakenError: string | null = null;
  // Start with Binance, then Coinbase, then the large independent Kraken archive.
  const products = [...request.config.products].sort((a, b) =>
    ['binance', 'coinbase', 'kraken'].indexOf(a.instrument.venue) -
    ['binance', 'coinbase', 'kraken'].indexOf(b.instrument.venue));
  for (const product of products) {
    const venue = product.instrument.venue;
    const floor = venue === 'binance' ? Date.UTC(2017, 6, 1) : venue === 'coinbase' ? Date.UTC(2012, 0, 1) : 0;
    const start = Math.max(request.config.startTimeMs ?? floor, floor);
    const end = request.config.endExclusiveMs;
    const item: AcquisitionInstrumentReport = {
      product, requestedStartTimeMs: start, requestedEndExclusiveMs: end,
      status: 'failed', failure: null, datasetHash: null, manifestHash: null, datasetDir: null,
      envelopePaths: [], unavailablePeriods: [], coverage: coverageOf([], start, end),
      missingnessMeaning: venue === 'kraken'
        ? 'Before first observation: eligibility unknown. Within successfully acquired release coverage, absent intervals indicate no reported trades. After the release cutoff, data is unpublished. Failed acquisitions remain source errors.'
        : 'Unobserved intervals are retained; they do not establish listing eligibility or authorize synthesized candles.',
      publishedReleaseEndExclusiveMs: null,
    };
    try {
      if (request.signal?.aborted) throw new Error('Acquisition canceled.');
      if (!snapshots.has(venue) && !snapshotErrors.has(venue)) {
        try { snapshots.set(venue, await snapshotVenue(context, venue)); }
        catch (error) { snapshotErrors.set(venue, error instanceof Error ? error.message : 'Source snapshot failed.'); }
      }
      if (snapshotErrors.has(venue)) throw new Error(snapshotErrors.get(venue));
      const providerContext = { ...context, snapshots: snapshots.get(venue)! };
      let acquisition: ProviderAcquisition;
      if (venue === 'binance') acquisition = await acquireBinanceProduct(providerContext, product, start, end);
      else if (venue === 'coinbase') acquisition = await acquireCoinbaseProduct(providerContext, product, start, end);
      else {
        if (!kraken && !krakenError) {
          try { kraken = await acquireKrakenProducts(providerContext, products.filter((p) => p.instrument.venue === 'kraken')); }
          catch (error) { krakenError = error instanceof Error ? error.message : 'Kraken acquisition failed.'; }
        }
        if (krakenError || !kraken) throw new Error(krakenError ?? 'Kraken acquisition failed.');
        acquisition = kraken.products.get(product.instrument.productId)!;
        item.publishedReleaseEndExclusiveMs = kraken.releaseEndExclusiveMs;
      }
      item.failure = acquisition.failure ?? null;
      const records = mergeAcquiredRecords(acquisition.records);
      item.coverage = coverageOf(records, start, end);
      item.envelopePaths = acquisition.envelopes; item.unavailablePeriods = acquisition.unavailable;
      if (records.length === 0) throw new Error(item.failure ?? 'No verified complete observations were acquired.');
      const manifest = await publishDataset(request.config, records, acquisition.sources,
        request.codeRevision, request.retrievedAtMs);
      item.datasetHash = manifest.datasetHash; item.manifestHash = manifest.manifestHash;
      item.datasetDir = join(request.config.archiveDir, 'datasets', manifest.datasetHash);
      item.status = item.failure ? 'failed' : 'verified';
    } catch (error) {
      // Only local validation and sanitized adapter diagnostics reach the report.
      item.failure = error instanceof Error ? error.message : 'Acquisition failed.';
      request.progress?.(`${venue} ${product.instrument.productId}: failed (${item.failure})`);
    }
    instruments.push(item);
  }
  const body = { schemaVersion: 1 as const, ok: instruments.every((item) => item.status === 'verified'),
    retrievedAtMs: request.retrievedAtMs, codeRevision: request.codeRevision, config: request.config, instruments };
  const report = { ...body, reportHash: digest(JSON.stringify(body)) };
  const directory = preserveBundle(request.config.reportDir, {
    'report.json': JSON.stringify(report, null, 2) + '\n', 'report.md': renderMarketAcquisitionReport(report),
  });
  return { report, directory };
}
async function publishDataset(config: MarketAcquisitionConfig, records: MarketBarRecord[],
  sources: ArchiveSourceArtifact[], codeRevision: string, createdAtMs: number) {
  const manifest = await writeMarketBarArchive({ rootDir: config.archiveDir,
    records, sourceArtifacts: sources, codeRevision, createdAtMs });
  await verifyMarketBarArchive(join(config.archiveDir, 'datasets', manifest.datasetHash));
  return manifest;
}
