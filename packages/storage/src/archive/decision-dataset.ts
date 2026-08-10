import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

import {
  buildDecisionMarketDataset,
  instrumentKey,
  type DecisionMarketDataset,
  type InstrumentIdentity,
  type InstrumentKey,
  type MarketBar,
} from '@coqui/core';

import { sha256Text, validateHash } from './common.js';
import { queryMarketBarArchive, verifyMarketBarArchive } from './reader.js';
import type { ArchivedMarketBar } from './types.js';

const DAY_MS = 86_400_000;
const COINBASE_COMPLETION_DELAY_MS = 5 * 60_000;

export interface PreparedDecisionDatasetManifest {
  readonly schemaVersion: 1;
  readonly decisionDatasetHash: string;
  readonly codeRevision: string;
  readonly sourceArchives: readonly {
    readonly datasetHash: string;
    readonly manifestHash: string;
    readonly codeRevision: string;
  }[];
  readonly instruments: readonly InstrumentIdentity[];
  readonly startTimeMs: number;
  readonly endExclusiveMs: number;
  readonly generatedAtMs: number;
  readonly alignedDayCount: number;
  readonly quality: 'reported_ohlc';
  readonly manifestHash: string;
}

export interface PrepareDecisionDatasetRequest {
  readonly rootDir: string;
  readonly sourceDatasetDirs: readonly string[];
  readonly instruments: readonly InstrumentIdentity[];
  readonly startTimeMs: number;
  readonly endExclusiveMs: number;
  readonly codeRevision: string;
}

export interface PreparedDecisionDataset {
  readonly dataset: DecisionMarketDataset;
  readonly manifest: PreparedDecisionDatasetManifest;
  readonly directory: string;
}

export interface CommonContinuousCoverage {
  readonly startTimeMs: number;
  readonly endExclusiveMs: number;
  readonly dayCount: number;
}

/** Select the longest shared continuous UTC-day run; a tie resolves to the latest run. */
export function deepestCommonContinuousCoverage(
  startsByAsset: readonly (readonly number[])[],
): CommonContinuousCoverage | null {
  if (startsByAsset.length === 0) return null;
  const sets = startsByAsset.map((values) => {
    const set = new Set<number>();
    for (const value of values) {
      if (!Number.isSafeInteger(value) || value < 0 || value % DAY_MS !== 0) {
        throw new TypeError('Coverage intervals must be UTC-day start timestamps.');
      }
      set.add(value);
    }
    return set;
  });
  const shared = [...sets[0]!].filter((value) =>
    sets.slice(1).every((set) => set.has(value))).sort((left, right) => left - right);
  if (shared.length === 0) return null;
  let bestStart = shared[0]!;
  let bestEnd = shared[0]!;
  let runStart = shared[0]!;
  let prior = shared[0]!;
  for (const value of shared.slice(1)) {
    if (value !== prior + DAY_MS) {
      if (prior - runStart >= bestEnd - bestStart) {
        bestStart = runStart;
        bestEnd = prior;
      }
      runStart = value;
    }
    prior = value;
  }
  if (prior - runStart >= bestEnd - bestStart) {
    bestStart = runStart;
    bestEnd = prior;
  }
  return Object.freeze({
    startTimeMs: bestStart,
    endExclusiveMs: bestEnd + DAY_MS,
    dayCount: (bestEnd - bestStart) / DAY_MS + 1,
  });
}

function validateRequest(request: PrepareDecisionDatasetRequest): InstrumentIdentity[] {
  if (request.sourceDatasetDirs.length === 0) throw new TypeError('At least one archive is required.');
  if (request.instruments.length === 0) throw new TypeError('At least one instrument is required.');
  if (request.codeRevision.length === 0 || request.codeRevision.length > 200) {
    throw new TypeError('An explicit code revision is required.');
  }
  for (const boundary of [request.startTimeMs, request.endExclusiveMs]) {
    if (!Number.isSafeInteger(boundary) || boundary < 0 || boundary % DAY_MS !== 0) {
      throw new TypeError('Decision-dataset boundaries must be UTC midnights.');
    }
  }
  if (request.startTimeMs >= request.endExclusiveMs) {
    throw new RangeError('Decision-dataset coverage must have positive duration.');
  }
  const unique = new Map<InstrumentKey, InstrumentIdentity>();
  for (const instrument of request.instruments) {
    if (instrument.venue !== 'coinbase' || instrument.productType !== 'spot') {
      throw new TypeError('Executable research datasets require Coinbase spot instruments only.');
    }
    const key = instrumentKey(instrument);
    if (unique.has(key)) throw new TypeError(`Duplicate requested instrument: ${key}`);
    unique.set(key, Object.freeze({ ...instrument }));
  }
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([, instrument]) => instrument);
}

function coreBar(row: ArchivedMarketBar): MarketBar {
  if (row.source !== 'coinbase' || row.venue !== 'coinbase' ||
      row.productType !== 'spot' || row.quality !== 'reported_ohlc' || !row.isComplete) {
    throw new TypeError('Decision preparation accepts complete reported Coinbase OHLC only.');
  }
  return {
    assetId: instrumentKey({ venue: 'coinbase', productId: row.productId, productType: 'spot' }),
    source: 'coinbase',
    interval: '1d',
    startTimeMs: row.startTimeMs,
    endTimeMs: row.endTimeMs,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume === null ? null : Number(row.volume),
    isComplete: row.isComplete,
    quality: row.quality,
    retrievedAtMs: row.retrievedAtMs,
  };
}

function manifestWithHash(
  value: Omit<PreparedDecisionDatasetManifest, 'manifestHash'>,
): PreparedDecisionDatasetManifest {
  return Object.freeze({ ...value, manifestHash: sha256Text(JSON.stringify(value)) });
}

export function verifyPreparedDecisionDatasetManifest(
  path: string,
): PreparedDecisionDatasetManifest {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as PreparedDecisionDatasetManifest;
  if (raw.schemaVersion !== 1 || raw.quality !== 'reported_ohlc') {
    throw new TypeError('Unsupported prepared decision-dataset manifest.');
  }
  validateHash(raw.decisionDatasetHash, 'decisionDatasetHash');
  validateHash(raw.manifestHash, 'manifestHash');
  for (const archive of raw.sourceArchives) {
    validateHash(archive.datasetHash, 'source datasetHash');
    validateHash(archive.manifestHash, 'source manifestHash');
  }
  const { manifestHash, ...withoutHash } = raw;
  if (sha256Text(JSON.stringify(withoutHash)) !== manifestHash) {
    throw new Error('Prepared decision-dataset manifest failed integrity validation.');
  }
  if (basename(resolve(path, '..')) !== manifestHash) {
    throw new Error('Prepared decision-dataset directory does not match its manifest hash.');
  }
  return Object.freeze(raw);
}

function writeManifest(
  rootDir: string,
  manifest: PreparedDecisionDatasetManifest,
): string {
  const parent = join(resolve(rootDir), 'prepared-decision-datasets');
  const destination = join(parent, manifest.manifestHash);
  const manifestPath = join(destination, 'manifest.json');
  if (existsSync(manifestPath)) {
    verifyPreparedDecisionDatasetManifest(manifestPath);
    return destination;
  }
  mkdirSync(parent, { recursive: true });
  const temporary = join(parent, `.${manifest.manifestHash}.${randomUUID()}`);
  mkdirSync(temporary, { recursive: false });
  try {
    writeFileSync(join(temporary, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    renameSync(temporary, destination);
    return destination;
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: false });
    throw error;
  }
}

/** Verify and merge immutable Coinbase archives into one exact decision dataset. */
export async function prepareDecisionDatasetFromArchives(
  request: PrepareDecisionDatasetRequest,
): Promise<PreparedDecisionDataset> {
  const instruments = validateRequest(request);
  const requestedProducts = new Set(instruments.map((instrument) => instrument.productId));
  const directories = [...new Set(request.sourceDatasetDirs.map((directory) => resolve(directory)))].sort();
  if (directories.length !== request.sourceDatasetDirs.length) {
    throw new TypeError('Source archive directories must be unique.');
  }
  const sourceArchives: Array<PreparedDecisionDatasetManifest['sourceArchives'][number]> = [];
  const rows: ArchivedMarketBar[] = [];
  for (const directory of directories) {
    const sourceManifest = await verifyMarketBarArchive(directory);
    if (sourceManifest.files.some((file) => file.venue !== 'coinbase')) {
      throw new TypeError('Decision preparation rejects archives containing non-Coinbase venues.');
    }
    sourceArchives.push({
      datasetHash: sourceManifest.datasetHash,
      manifestHash: sourceManifest.manifestHash,
      codeRevision: sourceManifest.codeRevision,
    });
    const archived = await queryMarketBarArchive(directory, {
      venue: 'coinbase',
      startTimeMs: request.startTimeMs,
      endTimeMs: request.endExclusiveMs,
    });
    rows.push(...archived.filter((row) => requestedProducts.has(row.productId)));
  }
  const seen = new Set<string>();
  const input: Record<InstrumentKey, MarketBar[]> = {};
  for (const instrument of instruments) input[instrumentKey(instrument)] = [];
  for (const row of rows) {
    const key = `${row.productId}|${row.startTimeMs}`;
    if (seen.has(key)) throw new TypeError(`Duplicate archived Coinbase interval: ${key}`);
    seen.add(key);
    const bar = coreBar(row);
    input[bar.assetId]!.push(bar);
  }
  const generatedAtMs = Math.max(
    request.endExclusiveMs + COINBASE_COMPLETION_DELAY_MS,
    ...rows.map((row) => row.retrievedAtMs),
  );
  const dataset = buildDecisionMarketDataset(input, instruments.map(instrumentKey), {
    policy: 'reject-on-gap',
    nowMs: generatedAtMs,
    expectedSource: 'coinbase',
  });
  const expectedDays = (request.endExclusiveMs - request.startTimeMs) / DAY_MS;
  if (dataset.dayKeys.length !== expectedDays || dataset.report.issues.length > 0) {
    throw new Error('Coinbase archives do not provide exact gap-free requested coverage.');
  }
  const first = dataset.barsById[dataset.assets[0]!]?.[0]?.startTimeMs;
  const last = dataset.barsById[dataset.assets[0]!]?.at(-1)?.endTimeMs;
  if (first !== request.startTimeMs || last !== request.endExclusiveMs) {
    throw new Error('Prepared decision-dataset boundaries differ from the request.');
  }
  sourceArchives.sort((left, right) => left.datasetHash.localeCompare(right.datasetHash));
  const manifest = manifestWithHash({
    schemaVersion: 1,
    decisionDatasetHash: dataset.report.datasetHash,
    codeRevision: request.codeRevision,
    sourceArchives: Object.freeze(sourceArchives.map((archive) => Object.freeze(archive))),
    instruments: Object.freeze(instruments),
    startTimeMs: request.startTimeMs,
    endExclusiveMs: request.endExclusiveMs,
    generatedAtMs,
    alignedDayCount: dataset.dayKeys.length,
    quality: 'reported_ohlc',
  });
  const directory = writeManifest(request.rootDir, manifest);
  return Object.freeze({ dataset, manifest, directory });
}
