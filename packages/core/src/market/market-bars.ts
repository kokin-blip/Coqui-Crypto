import { sha256Hex } from '../crypto/sha256.js';
import type { InstrumentKey } from '../types/instrument.js';

export type MarketBarSource = 'binance' | 'coinbase' | 'coingecko' | 'fixture' | 'kraken';
export type AlignmentPolicy = 'intersection' | 'reference-calendar' | 'reject-on-gap';
export type MarketBarQuality = 'reported_ohlc' | 'close_only_legacy' | 'synthetic_ohlc';

export interface MarketBar {
  assetId: InstrumentKey;
  source: MarketBarSource;
  interval: '1d';
  startTimeMs: number;
  endTimeMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  isComplete: boolean;
  retrievedAtMs: number;
  /** Whether OHLC values came from the provider or a compatibility adapter. */
  quality?: MarketBarQuality;
}

export interface MarketBarIssue {
  assetId: InstrumentKey;
  dayKey: string | null;
  code:
    | 'duplicate'
    | 'gap'
    | 'non_monotonic'
    | 'invalid_ohlc'
    | 'invalid_price'
    | 'invalid_volume'
    | 'invalid_interval'
    | 'incomplete'
    | 'future'
    | 'provider_mismatch';
  message: string;
}

export interface AlignmentReport {
  policy: AlignmentPolicy;
  alignedIntervalKeys: string[];
  requestedAssets: InstrumentKey[];
  retainedBarsByAsset: Record<InstrumentKey, number>;
  droppedBarsByAsset: Record<InstrumentKey, number>;
  missingKeysByAsset: Record<InstrumentKey, string[]>;
  duplicateKeysByAsset: Record<InstrumentKey, string[]>;
  firstAlignedInterval: string | null;
  lastAlignedInterval: string | null;
  retentionRatioByAsset: Record<InstrumentKey, number>;
  issues: MarketBarIssue[];
  datasetHash: string;
  unionIntervalCount: number;
  intersectionIntervalCount: number;
  incompleteKeysByAsset: Record<InstrumentKey, string[]>;
  invalidKeysByAsset: Record<InstrumentKey, string[]>;
  droppedIntervalKeysByAsset: Record<InstrumentKey, string[]>;
  qualityWarningsByAsset: Record<InstrumentKey, string[]>;
  providerCoverageByAsset: Record<
    InstrumentKey,
    { sources: MarketBarSource[]; firstInterval: string | null; lastInterval: string | null }
  >;
}

export interface AlignedMarketBars {
  assets: InstrumentKey[];
  dayKeys: string[];
  closesById: Record<InstrumentKey, number[]>;
  opensById: Record<InstrumentKey, number[]>;
  barsById: Record<InstrumentKey, MarketBar[]>;
  report: AlignmentReport;
}

/**
 * Immutable, timestamp-preserving input for any strategy or paper decision.
 * Display-only consumers may still use close arrays, but decision code should
 * receive this object so completion, provenance and alignment cannot be lost.
 */
export interface DecisionMarketDataset extends AlignedMarketBars {
  generatedAtMs: number;
  sourcesByAsset: Record<InstrumentKey, MarketBarSource[]>;
  qualitiesByAsset: Record<InstrumentKey, MarketBarQuality[]>;
  latestRetrievedAtMsByAsset: Record<InstrumentKey, number | null>;
}

const DAY_MS = 86_400_000;
const SOURCE_COMPLETION_DELAY_MS: Record<MarketBarSource, number> = {
  binance: 0,
  coinbase: 5 * 60_000,
  coingecko: 15 * 60_000,
  fixture: 0,
  kraken: 0,
};

export function utcDayKey(timestampMs: number): string {
  return new Date(Math.floor(timestampMs / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validateBar(bar: MarketBar, nowMs: number): MarketBarIssue[] {
  const dayKey = Number.isFinite(bar.startTimeMs) ? utcDayKey(bar.startTimeMs) : null;
  const issues: MarketBarIssue[] = [];
  const add = (code: MarketBarIssue['code'], message: string) =>
    issues.push({ assetId: bar.assetId, dayKey, code, message });
  if (
    !finitePositive(bar.open) ||
    !finitePositive(bar.high) ||
    !finitePositive(bar.low) ||
    !finitePositive(bar.close)
  ) {
    add('invalid_price', 'OHLC prices must be finite and positive.');
  } else if (
    bar.high < bar.low ||
    bar.open < bar.low ||
    bar.open > bar.high ||
    bar.close < bar.low ||
    bar.close > bar.high
  ) {
    add('invalid_ohlc', 'OHLC values are internally inconsistent.');
  }
  if (bar.volume !== null && (!Number.isFinite(bar.volume) || bar.volume < 0)) {
    add('invalid_volume', 'Volume must be null or a finite non-negative number.');
  }
  if (bar.endTimeMs - bar.startTimeMs !== DAY_MS) {
    add('invalid_interval', 'Daily bars must cover exactly one UTC day.');
  }
  if (
    !bar.isComplete ||
    bar.endTimeMs + SOURCE_COMPLETION_DELAY_MS[bar.source] > nowMs
  ) {
    add('incomplete', 'The interval is not complete and cannot be observed by a strategy.');
  }
  if (bar.startTimeMs > nowMs) add('future', 'The interval starts in the future.');
  return issues;
}

function stableHash(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

export function alignMarketBars(
  input: Record<InstrumentKey, MarketBar[]>,
  requestedAssets: InstrumentKey[],
  options: {
    policy?: AlignmentPolicy;
    referenceAssetId?: InstrumentKey;
    nowMs: number;
    expectedSource?: MarketBarSource;
  },
): AlignedMarketBars {
  const policy = options.policy ?? 'intersection';
  const nowMs = options.nowMs;
  const assets = [...new Set(requestedAssets)].sort();
  const issues: MarketBarIssue[] = [];
  const maps = new Map<InstrumentKey, Map<string, MarketBar>>();
  const duplicateKeysByAsset: Record<InstrumentKey, string[]> = {};

  for (const assetId of assets) {
    const rows = input[assetId] ?? [];
    const byDay = new Map<string, MarketBar>();
    duplicateKeysByAsset[assetId] = [];
    let previous = -Infinity;
    for (const bar of rows) {
      const dayKey = Number.isFinite(bar.startTimeMs) ? utcDayKey(bar.startTimeMs) : null;
      if (bar.assetId !== assetId) {
        issues.push({
          assetId,
          dayKey,
          code: 'provider_mismatch',
          message: `Bar identity ${bar.assetId} does not match requested asset ${assetId}.`,
        });
        continue;
      }
      if (bar.startTimeMs <= previous) {
        issues.push({
          assetId,
          dayKey,
          code: 'non_monotonic',
          message: 'Bars must arrive in strictly increasing timestamp order.',
        });
      }
      previous = bar.startTimeMs;
      const validation = validateBar(bar, nowMs);
      issues.push(...validation);
      if (options.expectedSource && bar.source !== options.expectedSource) {
        issues.push({
          assetId,
          dayKey,
          code: 'provider_mismatch',
          message: `Expected ${options.expectedSource} data but received ${bar.source}.`,
        });
      }
      if (!dayKey || validation.length > 0) continue;
      if (byDay.has(dayKey)) {
        duplicateKeysByAsset[assetId]!.push(dayKey);
        issues.push({
          assetId,
          dayKey,
          code: 'duplicate',
          message: 'Duplicate interval key.',
        });
        continue;
      }
      byDay.set(dayKey, bar);
    }
    maps.set(assetId, byDay);
  }

  const coverageKeys = [
    ...new Set(assets.flatMap((assetId) => [...(maps.get(assetId)?.keys() ?? [])])),
  ].sort();
  const calendarKeys: string[] = [];
  if (coverageKeys.length > 0) {
    const first = Date.parse(`${coverageKeys[0]!}T00:00:00.000Z`);
    const last = Date.parse(`${coverageKeys.at(-1)!}T00:00:00.000Z`);
    for (let at = first; at <= last; at += DAY_MS) calendarKeys.push(utcDayKey(at));
  }
  const intersectionKeys = calendarKeys.filter((key) =>
    assets.every((assetId) => maps.get(assetId)?.has(key)),
  );
  let alignedKeys: string[] = [];
  if (assets.length > 0) {
    const reference =
      policy === 'reference-calendar'
        ? (options.referenceAssetId ?? assets[0]!)
        : assets[0]!;
    alignedKeys = [...(maps.get(reference)?.keys() ?? [])];
    if (policy !== 'reference-calendar') {
      alignedKeys = alignedKeys.filter((key) =>
        assets.every((assetId) => maps.get(assetId)?.has(key)),
      );
    }
    alignedKeys.sort();
  }

  const missingKeysByAsset: Record<InstrumentKey, string[]> = {};
  const retainedBarsByAsset: Record<InstrumentKey, number> = {};
  const droppedBarsByAsset: Record<InstrumentKey, number> = {};
  const retentionRatioByAsset: Record<InstrumentKey, number> = {};
  const barsById: Record<InstrumentKey, MarketBar[]> = {};
  const closesById: Record<InstrumentKey, number[]> = {};
  const opensById: Record<InstrumentKey, number[]> = {};
  const incompleteKeysByAsset: Record<InstrumentKey, string[]> = {};
  const invalidKeysByAsset: Record<InstrumentKey, string[]> = {};
  const droppedIntervalKeysByAsset: Record<InstrumentKey, string[]> = {};
  const qualityWarningsByAsset: Record<InstrumentKey, string[]> = {};
  const providerCoverageByAsset: AlignmentReport['providerCoverageByAsset'] = {};

  for (const assetId of assets) {
    const byDay = maps.get(assetId)!;
    // Missingness describes the source dataset, not only the already-reduced
    // intersection. Otherwise ragged histories can misleadingly report no gaps.
    const missing = calendarKeys.filter((key) => !byDay.has(key));
    missingKeysByAsset[assetId] = missing;
    if (missing.length > 0) {
      issues.push(
        ...missing.map((dayKey) => ({
          assetId,
          dayKey,
          code: 'gap' as const,
          message: 'Asset is missing a required aligned interval.',
        })),
      );
    }
    const rows = alignedKeys.flatMap((key) => {
      const bar = byDay.get(key);
      return bar ? [bar] : [];
    });
    barsById[assetId] = rows;
    closesById[assetId] = rows.map((bar) => bar.close);
    opensById[assetId] = rows.map((bar) => bar.open);
    retainedBarsByAsset[assetId] = rows.length;
    droppedBarsByAsset[assetId] = Math.max(0, byDay.size - rows.length);
    retentionRatioByAsset[assetId] = byDay.size > 0 ? rows.length / byDay.size : 0;
    const assetIssues = issues.filter((issue) => issue.assetId === assetId);
    incompleteKeysByAsset[assetId] = [
      ...new Set(
        assetIssues
          .filter((issue) => issue.code === 'incomplete')
          .flatMap((issue) => (issue.dayKey ? [issue.dayKey] : [])),
      ),
    ];
    invalidKeysByAsset[assetId] = [
      ...new Set(
        assetIssues
          .filter((issue) =>
            [
              'invalid_ohlc',
              'invalid_price',
              'invalid_volume',
              'invalid_interval',
              'future',
              'provider_mismatch',
            ].includes(issue.code),
          )
          .flatMap((issue) => (issue.dayKey ? [issue.dayKey] : [])),
      ),
    ];
    droppedIntervalKeysByAsset[assetId] = [...byDay.keys()].filter(
      (key) => !alignedKeys.includes(key),
    );
    qualityWarningsByAsset[assetId] = [
      ...new Set(
        rows.flatMap((bar) => {
          const quality = bar.quality ?? 'reported_ohlc';
          return quality === 'reported_ohlc' ? [] : [quality];
        }),
      ),
    ];
    const sourceKeys = [...byDay.keys()].sort();
    providerCoverageByAsset[assetId] = {
      sources: [...new Set([...byDay.values()].map((bar) => bar.source))],
      firstInterval: sourceKeys[0] ?? null,
      lastInterval: sourceKeys[sourceKeys.length - 1] ?? null,
    };
  }

  if (
    policy === 'reject-on-gap' &&
    (issues.length > 0 ||
      assets.some((assetId) => (maps.get(assetId)?.size ?? 0) !== alignedKeys.length))
  ) {
    alignedKeys = [];
    for (const assetId of assets) {
      barsById[assetId] = [];
      closesById[assetId] = [];
      opensById[assetId] = [];
      retainedBarsByAsset[assetId] = 0;
      droppedBarsByAsset[assetId] = maps.get(assetId)?.size ?? 0;
      retentionRatioByAsset[assetId] = 0;
      droppedIntervalKeysByAsset[assetId] = [...(maps.get(assetId)?.keys() ?? [])].sort();
    }
  }

  const hashInput = {
    policy,
    assets,
    keys: alignedKeys,
    bars: assets.map((assetId) =>
      (barsById[assetId] ?? []).map((bar) => [
        bar.source,
        bar.quality ?? 'reported_ohlc',
        bar.startTimeMs,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume,
        bar.retrievedAtMs,
      ]),
    ),
  };
  const report: AlignmentReport = {
    policy,
    alignedIntervalKeys: alignedKeys,
    requestedAssets: [...assets],
    retainedBarsByAsset,
    droppedBarsByAsset,
    missingKeysByAsset,
    duplicateKeysByAsset,
    firstAlignedInterval: alignedKeys[0] ?? null,
    lastAlignedInterval: alignedKeys[alignedKeys.length - 1] ?? null,
    retentionRatioByAsset,
    issues,
    datasetHash: stableHash(hashInput),
    unionIntervalCount: coverageKeys.length,
    intersectionIntervalCount: intersectionKeys.length,
    incompleteKeysByAsset,
    invalidKeysByAsset,
    droppedIntervalKeysByAsset,
    qualityWarningsByAsset,
    providerCoverageByAsset,
  };
  return { assets, dayKeys: alignedKeys, closesById, opensById, barsById, report };
}

export function buildDecisionMarketDataset(
  input: Record<InstrumentKey, MarketBar[]>,
  requestedAssets: InstrumentKey[],
  options: Parameters<typeof alignMarketBars>[2],
): DecisionMarketDataset {
  const generatedAtMs = options.nowMs;
  const aligned = alignMarketBars(input, requestedAssets, { ...options, nowMs: generatedAtMs });
  const sourcesByAsset: Record<InstrumentKey, MarketBarSource[]> = {};
  const qualitiesByAsset: Record<InstrumentKey, MarketBarQuality[]> = {};
  const latestRetrievedAtMsByAsset: Record<InstrumentKey, number | null> = {};
  for (const assetId of aligned.assets) {
    const bars = aligned.barsById[assetId] ?? [];
    sourcesByAsset[assetId] = [...new Set(bars.map((bar) => bar.source))];
    qualitiesByAsset[assetId] = [
      ...new Set(bars.map((bar) => bar.quality ?? 'reported_ohlc')),
    ];
    latestRetrievedAtMsByAsset[assetId] =
      bars.length > 0 ? Math.max(...bars.map((bar) => bar.retrievedAtMs)) : null;
  }
  const immutableBarsById: Record<InstrumentKey, MarketBar[]> = {};
  for (const assetId of aligned.assets) {
    immutableBarsById[assetId] = (aligned.barsById[assetId] ?? []).map((bar) => ({ ...bar }));
  }
  return deepFreeze({
    ...aligned,
    barsById: immutableBarsById,
    generatedAtMs,
    sourcesByAsset,
    qualitiesByAsset,
    latestRetrievedAtMsByAsset,
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function dailyCloseRowsToMarketBars(
  assetId: InstrumentKey,
  rows: Array<{ timeS: number; close: number }>,
  options: {
    source?: MarketBarSource;
    nowMs: number;
    retrievedAtMs?: number;
    completenessDelayMs?: number;
  },
): MarketBar[] {
  const nowMs = options.nowMs;
  const delayMs = Math.max(0, options.completenessDelayMs ?? 5 * 60_000);
  return rows.map((row) => {
    const startTimeMs = row.timeS * 1000;
    const endTimeMs = startTimeMs + DAY_MS;
    return {
      assetId,
      source: options.source ?? 'coinbase',
      interval: '1d',
      startTimeMs,
      endTimeMs,
      open: row.close,
      high: row.close,
      low: row.close,
      close: row.close,
      volume: null,
      isComplete: endTimeMs + delayMs <= nowMs,
      retrievedAtMs: options.retrievedAtMs ?? nowMs,
      quality: 'close_only_legacy',
    };
  });
}
