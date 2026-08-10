import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  deepestCommonContinuousCoverage,
  prepareDecisionDatasetFromArchives,
  verifyPreparedDecisionDatasetManifest,
  writeMarketBarArchive,
  type MarketBarRecord,
} from '../packages/storage/src/index.js';

const DAY_MS = 86_400_000;
const start = Date.UTC(2024, 0, 1);
const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'coqui-prepared-dataset-'));
  roots.push(root);
  return root;
}

function bar(
  productId: string,
  day: number,
  overrides: Partial<MarketBarRecord> = {},
): MarketBarRecord {
  const startTimeMs = start + day * DAY_MS;
  return Object.freeze({
    source: 'coinbase',
    instrument: { venue: 'coinbase', productId, productType: 'spot' } as const,
    providerAssetId: productId,
    interval: '1d',
    startTimeMs,
    endTimeMs: startTimeMs + DAY_MS,
    open: `${100 + day}.000000000000000001`,
    high: `${110 + day}.000000000000000002`,
    low: `${90 + day}.000000000000000003`,
    close: `${105 + day}.123456789123456789`,
    volume: `${12 + day}.500000000000000001`,
    isComplete: true,
    quality: 'reported_ohlc',
    retrievedAtMs: start + 4 * DAY_MS,
    ...overrides,
  });
}

async function archive(
  rootDir: string,
  productId: string,
  records: readonly MarketBarRecord[],
  artifactSeed: string,
): Promise<string> {
  const manifest = await writeMarketBarArchive({
    rootDir,
    records,
    sourceArtifacts: [{
      sourceId: `coinbase:${productId}:${artifactSeed}`,
      manifestHash: artifactSeed.repeat(64),
      rawContentHash: artifactSeed.repeat(64),
    }],
    codeRevision: 'source-revision',
    createdAtMs: start + 4 * DAY_MS,
  });
  return join(rootDir, 'datasets', manifest.datasetHash);
}

function request(rootDir: string, sourceDatasetDirs: readonly string[]) {
  return {
    rootDir,
    sourceDatasetDirs,
    instruments: [
      { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' },
      { venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' },
    ] as const,
    startTimeMs: start,
    endExclusiveMs: start + 3 * DAY_MS,
    codeRevision: 'decision-revision',
  } as const;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('prepared Coinbase decision dataset', () => {
  it('selects the longest shared continuous run and resolves ties to the latest', () => {
    expect(deepestCommonContinuousCoverage([
      [start, start + DAY_MS, start + 3 * DAY_MS, start + 4 * DAY_MS],
      [start, start + DAY_MS, start + 3 * DAY_MS, start + 4 * DAY_MS],
    ])).toEqual({
      startTimeMs: start + 3 * DAY_MS,
      endExclusiveMs: start + 5 * DAY_MS,
      dayCount: 2,
    });
    expect(deepestCommonContinuousCoverage([[start], []])).toBeNull();
  });

  it('deterministically prepares and verifies a gap-free multi-asset manifest', async () => {
    const archiveRoot = temporaryRoot();
    const outputRoot = temporaryRoot();
    const btc = await archive(archiveRoot, 'BTC-USD', [0, 1, 2].map((day) => bar('BTC-USD', day)), 'a');
    const eth = await archive(archiveRoot, 'ETH-USD', [0, 1, 2].map((day) => bar('ETH-USD', day)), 'b');

    const first = await prepareDecisionDatasetFromArchives(request(outputRoot, [eth, btc]));
    const second = await prepareDecisionDatasetFromArchives(request(outputRoot, [btc, eth]));

    expect(first.manifest.alignedDayCount).toBe(3);
    expect(first.manifest.decisionDatasetHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.manifest).toEqual(first.manifest);
    expect(second.directory).toBe(first.directory);
    expect(verifyPreparedDecisionDatasetManifest(
      join(first.directory, 'manifest.json'),
    )).toEqual(first.manifest);
  });

  it('rejects missing days and duplicate logical intervals', async () => {
    const archiveRoot = temporaryRoot();
    const outputRoot = temporaryRoot();
    const btc = await archive(archiveRoot, 'BTC-USD', [0, 1, 2].map((day) => bar('BTC-USD', day)), 'c');
    const ethGap = await archive(archiveRoot, 'ETH-USD', [0, 2].map((day) => bar('ETH-USD', day)), 'd');
    await expect(prepareDecisionDatasetFromArchives(request(outputRoot, [btc, ethGap])))
      .rejects.toThrow('gap-free');

    const eth = await archive(archiveRoot, 'ETH-USD', [0, 1, 2].map((day) => bar('ETH-USD', day)), 'e');
    const duplicateBtc = await archive(
      temporaryRoot(), 'BTC-USD', [0, 1, 2].map((day) => bar('BTC-USD', day)), 'f',
    );
    await expect(prepareDecisionDatasetFromArchives(request(outputRoot, [btc, duplicateBtc, eth])))
      .rejects.toThrow('Duplicate archived Coinbase interval');
  });

  it('rejects aggregate-provider rows and non-reported OHLC', async () => {
    const archiveRoot = temporaryRoot();
    const outputRoot = temporaryRoot();
    const coingecko = await archive(archiveRoot, 'BTC-USD', [0, 1, 2].map((day) =>
      bar('BTC-USD', day, { source: 'coingecko' })), '1');
    const eth = await archive(archiveRoot, 'ETH-USD', [0, 1, 2].map((day) => bar('ETH-USD', day)), '2');
    await expect(prepareDecisionDatasetFromArchives(request(outputRoot, [coingecko, eth])))
      .rejects.toThrow('reported Coinbase OHLC');

    const synthetic = await archive(temporaryRoot(), 'BTC-USD', [0, 1, 2].map((day) =>
      bar('BTC-USD', day, { quality: 'synthetic_ohlc' })), '3');
    await expect(prepareDecisionDatasetFromArchives(request(outputRoot, [synthetic, eth])))
      .rejects.toThrow('reported Coinbase OHLC');
  });

  it('detects prepared-manifest tampering', async () => {
    const archiveRoot = temporaryRoot();
    const outputRoot = temporaryRoot();
    const btc = await archive(archiveRoot, 'BTC-USD', [0, 1, 2].map((day) => bar('BTC-USD', day)), '4');
    const eth = await archive(archiveRoot, 'ETH-USD', [0, 1, 2].map((day) => bar('ETH-USD', day)), '5');
    const prepared = await prepareDecisionDatasetFromArchives(request(outputRoot, [btc, eth]));
    const manifestPath = join(prepared.directory, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest['alignedDayCount'] = 99;
    writeFileSync(manifestPath, JSON.stringify(manifest));

    expect(() => verifyPreparedDecisionDatasetManifest(manifestPath))
      .toThrow('integrity validation');
  });
});
