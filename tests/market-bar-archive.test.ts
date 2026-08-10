import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  queryMarketBarArchive,
  verifyMarketBarArchive,
  writeMarketBarArchive,
  type MarketBarRecord,
} from '../packages/storage/src/index.js';

const roots: string[] = [];
const DAY_MS = 86_400_000;
const artifact = Object.freeze({
  sourceId: 'kraken:XBTUSD:Kraken_OHLCVT.zip',
  manifestHash: 'a'.repeat(64),
  rawContentHash: 'b'.repeat(64),
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'coqui-archive-'));
  roots.push(root);
  return root;
}

function bar(startTimeMs: number, productId = 'XBTUSD'): MarketBarRecord {
  return Object.freeze({
    source: 'kraken',
    instrument: { venue: 'kraken', productId, productType: 'spot' } as const,
    providerAssetId: productId,
    interval: '1d',
    startTimeMs,
    endTimeMs: startTimeMs + DAY_MS,
    open: '100.000000000000000001',
    high: '110.000000000000000002',
    low: '90.000000000000000003',
    close: '105.123456789123456789',
    volume: '12.500000000000000001',
    isComplete: true,
    quality: 'reported_ohlc',
    retrievedAtMs: startTimeMs + DAY_MS,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('immutable market-bar Parquet archive', () => {
  it('writes partitioned Parquet and verifies exact text through DuckDB', async () => {
    const rootDir = temporaryRoot();
    const first = Date.UTC(2023, 11, 31);
    const manifest = await writeMarketBarArchive({
      rootDir,
      records: [bar(first + DAY_MS), bar(first)],
      sourceArtifacts: [artifact],
      codeRevision: 'test-revision',
      createdAtMs: first + 2 * DAY_MS,
    });
    expect(manifest.files).toHaveLength(2);
    expect(manifest.files.map((file) => file.year)).toEqual([2023, 2024]);
    const datasetDir = join(rootDir, 'datasets', manifest.datasetHash);
    await expect(verifyMarketBarArchive(datasetDir)).resolves.toEqual(manifest);
    const rows = await queryMarketBarArchive(datasetDir, {
      venue: 'kraken', productId: 'XBTUSD', startTimeMs: first + DAY_MS,
    });
    expect(rows).toEqual([expect.objectContaining({
      startTimeMs: first + DAY_MS,
      open: '100.000000000000000001',
      close: '105.123456789123456789',
      volume: '12.500000000000000001',
    })]);
  });

  it('is content-addressed and returns the original immutable manifest on rerun', async () => {
    const rootDir = temporaryRoot();
    const start = Date.UTC(2024, 0, 1);
    const first = await writeMarketBarArchive({
      rootDir, records: [bar(start)], sourceArtifacts: [artifact],
      codeRevision: 'test-revision', createdAtMs: start + DAY_MS,
    });
    const second = await writeMarketBarArchive({
      rootDir, records: [bar(start)], sourceArtifacts: [artifact],
      codeRevision: 'test-revision', createdAtMs: start + 2 * DAY_MS,
    });
    expect(second).toEqual(first);
    expect(second.createdAtMs).toBe(start + DAY_MS);
  });

  it('detects Parquet byte tampering before a query is returned', async () => {
    const rootDir = temporaryRoot();
    const start = Date.UTC(2024, 0, 1);
    const manifest = await writeMarketBarArchive({
      rootDir, records: [bar(start)], sourceArtifacts: [artifact],
      codeRevision: 'test-revision', createdAtMs: start + DAY_MS,
    });
    const datasetDir = join(rootDir, 'datasets', manifest.datasetHash);
    const parquetPath = join(datasetDir, manifest.files[0]!.path);
    const bytes = readFileSync(parquetPath);
    bytes[20] = (bytes[20] ?? 0) ^ 1;
    writeFileSync(parquetPath, bytes);
    await expect(queryMarketBarArchive(datasetDir)).rejects.toThrow('content verification');
  });

  it('rejects duplicate intervals and incomplete provenance', async () => {
    const rootDir = temporaryRoot();
    const start = Date.UTC(2024, 0, 1);
    await expect(writeMarketBarArchive({
      rootDir, records: [bar(start), bar(start)], sourceArtifacts: [artifact],
      codeRevision: 'test-revision', createdAtMs: start + DAY_MS,
    })).rejects.toThrow('duplicate canonical interval');
    await expect(writeMarketBarArchive({
      rootDir, records: [bar(start)], sourceArtifacts: [],
      codeRevision: 'test-revision', createdAtMs: start + DAY_MS,
    })).rejects.toThrow('source artifact');
  });
});
