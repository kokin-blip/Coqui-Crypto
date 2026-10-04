import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  downloadBinanceMonthlyKlines, importBinanceMonthlyKlines,
  downloadCoinbaseDailyArchive, verifyCoinbaseDailyArchiveArtifact,
  type BinanceArchiveManifest, type BinanceMonthlyKlineRequest,
  type CoinbaseDailyArchiveManifest, type HttpClient,
} from '@coqui/adapters';
import type { ArchiveSourceArtifact, MarketBarRecord } from '@coqui/storage';
import {
  configurationHash, describeFile, digest, preserveBundle, preserveEnvelope, verifyEnvelope,
  type AcquisitionEnvelope, type RawArtifact,
} from './artifacts.js';
import { DAY_MS, type AcquisitionProduct, type MarketAcquisitionConfig } from './config.js';
import { normalizeAcquiredRecords } from './records.js';

export interface ProviderAcquisition {
  records: MarketBarRecord[];
  sources: ArchiveSourceArtifact[];
  envelopes: string[];
  unavailable: string[];
  failure?: string;
}
export interface AcquisitionContext {
  http: HttpClient;
  config: MarketAcquisitionConfig;
  retrievedAtMs: number;
  snapshots: RawArtifact[];
  signal?: AbortSignal;
  progress?: (message: string) => void;
}
function indexPath(root: string, sourceId: string): string {
  return join(root, 'index', `${digest(sourceId)}.json`);
}
export async function cachedAcquisition(context: AcquisitionContext, sourceId: string): Promise<{
  envelope: AcquisitionEnvelope; path: string;
} | null> {
  const path = indexPath(context.config.sourceDir, sourceId);
  if (context.config.refresh || !existsSync(path)) return null;
  const pointer = JSON.parse(readFileSync(path, 'utf8')) as { path: string };
  const envelope = await verifyEnvelope(pointer.path);
  if (envelope.sourceId !== sourceId) throw new Error('Acquisition index identifies another source.');
  return { envelope, path: pointer.path };
}
export async function retainAcquisition(context: AcquisitionContext, sourceId: string,
  files: Record<string, string | Uint8Array>, providerManifest: unknown,
  upstreamChecksums: Record<string, string>, retrievedAtMs = context.retrievedAtMs): Promise<{
    source: ArchiveSourceArtifact; path: string;
  }> {
  const directory = preserveBundle(join(context.config.sourceDir, 'raw'), files);
  const artifacts = await Promise.all(Object.keys(files).map((name) => describeFile(join(directory, name))));
  const saved = preserveEnvelope(context.config.sourceDir, { sourceId,
    configurationHash: configurationHash(context.config), retrievedAtMs,
    artifacts, snapshots: context.snapshots, providerManifest, upstreamChecksums });
  const path = indexPath(context.config.sourceDir, sourceId);
  mkdirSync(join(context.config.sourceDir, 'index'), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify({ path: saved.path }));
  renameSync(`${path}.tmp`, path);
  return saved;
}
export function cachedSource(envelope: AcquisitionEnvelope): ArchiveSourceArtifact {
  return { sourceId: envelope.sourceId, manifestHash: envelope.manifestHash,
    rawContentHash: digest(JSON.stringify(envelope.artifacts.map(({ sha256 }) => sha256))) };
}
export async function acquireBinanceProduct(context: AcquisitionContext, product: AcquisitionProduct,
  start: number, end: number): Promise<ProviderAcquisition> {
  const acquired: ProviderAcquisition = { records: [], sources: [], envelopes: [], unavailable: [] };
  const acquire = async (request: BinanceMonthlyKlineRequest): Promise<boolean> => {
    if (context.signal?.aborted) throw new Error('Acquisition canceled.');
    const period = request.day === undefined ? 'monthly' : 'daily';
    const date = `${request.year}-${String(request.month).padStart(2, '0')}` +
      (request.day === undefined ? '' : `-${String(request.day).padStart(2, '0')}`);
    const name = `${request.symbol}-1d-${date}.zip`;
    const sourceId = `binance-public-data:spot/${period}/klines/${request.symbol}/1d/${name}`;
    const prior = await cachedAcquisition(context, sourceId);
    if (prior) {
      const manifest = prior.envelope.providerManifest as BinanceArchiveManifest;
      const archive = prior.envelope.artifacts.find((item) => item.path.endsWith('.zip'));
      const checksum = prior.envelope.artifacts.find((item) => item.path.endsWith('.CHECKSUM'));
      if (!archive || !checksum) throw new Error('Cached Binance artifacts are incomplete.');
      const result = importBinanceMonthlyKlines({ ...request, retrievedAtMs: prior.envelope.retrievedAtMs },
        readFileSync(archive.path), readFileSync(checksum.path, 'utf8'));
      if (!result.ok || result.manifest.manifestHash !== manifest.manifestHash) {
        throw new Error('Cached Binance parsing failed verification.');
      }
      acquired.records.push(...normalizeAcquiredRecords(product, result.records, prior.envelope.retrievedAtMs, start, end));
      acquired.sources.push(cachedSource(prior.envelope));
      acquired.envelopes.push(prior.path);
      return true;
    }
    context.progress?.(`Binance ${request.symbol} ${date}`);
    const result = await downloadBinanceMonthlyKlines(context.http, request);
    if (!result.ok) {
      if (result.code === 'request_failed' && result.status === 404) {
        acquired.unavailable.push(sourceId); return false;
      }
      throw new Error(`Binance ${date}: ${result.code}:${result.status}`);
    }
    const saved = await retainAcquisition(context, sourceId, {
      [name]: result.archiveBytes, [`${name}.CHECKSUM`]: result.checksumText,
    }, result.manifest, { [name]: result.manifest.archiveSha256 });
    acquired.records.push(...normalizeAcquiredRecords(product, result.records, context.retrievedAtMs, start, end));
    acquired.sources.push(saved.source); acquired.envelopes.push(saved.path);
    return true;
  };
  try {
    const first = new Date(start);
    for (let monthStart = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1); monthStart < end;) {
      const date = new Date(monthStart);
      const year = date.getUTCFullYear(); const month = date.getUTCMonth() + 1;
      const nextMonth = Date.UTC(year, month, 1);
      const available = await acquire({ symbol: product.instrument.productId, year, month,
        retrievedAtMs: context.retrievedAtMs });
      if (!available) {
        for (let day = Math.max(start, monthStart); day < Math.min(end, nextMonth); day += DAY_MS) {
          await acquire({ symbol: product.instrument.productId, year, month,
            day: new Date(day).getUTCDate(), retrievedAtMs: context.retrievedAtMs });
        }
      }
      monthStart = nextMonth;
    }
  } catch (error) { acquired.failure = error instanceof Error ? error.message : 'Binance acquisition failed.'; }
  return acquired;
}
export async function acquireCoinbaseProduct(context: AcquisitionContext, product: AcquisitionProduct,
  start: number, end: number): Promise<ProviderAcquisition> {
  const acquired: ProviderAcquisition = { records: [], sources: [], envelopes: [], unavailable: [] };
  try {
    for (let pageStart = start; pageStart < end; pageStart += 300 * DAY_MS) {
      if (context.signal?.aborted) throw new Error('Acquisition canceled.');
      const pageEnd = Math.min(end, pageStart + 300 * DAY_MS);
      const sourceId = `coinbase-exchange-rest:${product.instrument.productId}:${pageStart}:${pageEnd}`;
      const prior = await cachedAcquisition(context, sourceId);
      if (prior) {
        const manifest = prior.envelope.providerManifest as CoinbaseDailyArchiveManifest;
        const raw = prior.envelope.artifacts[0];
        if (!raw || manifest.productId !== product.instrument.productId ||
            manifest.startTimeMs !== pageStart || manifest.endExclusiveMs !== pageEnd) {
          throw new Error('Cached Coinbase identity or coverage differs.');
        }
        const rows = verifyCoinbaseDailyArchiveArtifact(manifest, readFileSync(raw.path, 'utf8'));
        acquired.records.push(...normalizeAcquiredRecords(product, rows, prior.envelope.retrievedAtMs, start, end));
        acquired.sources.push(cachedSource(prior.envelope)); acquired.envelopes.push(prior.path);
        continue;
      }
      context.progress?.(`Coinbase ${product.instrument.productId} ${new Date(pageStart).toISOString().slice(0, 10)}`);
      const result = await downloadCoinbaseDailyArchive(context.http, {
        instrument: product.instrument, startTimeMs: pageStart, endExclusiveMs: pageEnd,
        retrievedAtMs: context.retrievedAtMs,
      });
      if (!result.ok) throw new Error(`Coinbase: ${result.code}:${result.status}`);
      verifyCoinbaseDailyArchiveArtifact(result.manifest, result.rawArtifactText);
      const saved = await retainAcquisition(context, sourceId,
        { [result.manifest.archivePath]: result.rawArtifactText }, result.manifest, {});
      acquired.records.push(...normalizeAcquiredRecords(product, result.records, context.retrievedAtMs, start, end));
      acquired.sources.push(saved.source); acquired.envelopes.push(saved.path);
    }
  } catch (error) { acquired.failure = error instanceof Error ? error.message : 'Coinbase acquisition failed.'; }
  return acquired;
}
