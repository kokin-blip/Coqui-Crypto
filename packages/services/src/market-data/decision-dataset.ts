import type { HttpFailure, HttpResult } from '@coqui/adapters';
import {
  alignMarketBars,
  buildDecisionMarketDataset,
  instrumentKey,
  type AlignmentPolicy,
  type AlignmentReport,
  type DecisionMarketDataset,
  type InstrumentIdentity,
  type InstrumentKey,
  type MarketBar,
} from '@coqui/core';
import {
  listMarketBars,
  upsertMarketBars,
  type Db,
  type MarketBarRecord,
} from '@coqui/storage';
import {
  NOOP_LOGGER,
  NOOP_METRICS,
  type OperationalMetrics,
  type StructuredLogger,
} from '@coqui/observability';

const DAY_MS = 86_400_000;
const COINBASE_COMPLETION_DELAY_MS = 5 * 60_000;

export type CoinbaseDailyBarFetcher = (
  instrument: InstrumentIdentity,
  options: { maxDays: number; nowMs: number; retrievedAtMs: number },
) => Promise<HttpResult<MarketBar[]>>;

export interface DecisionDatasetSyncOptions {
  readonly database: Db;
  readonly instruments: readonly InstrumentIdentity[];
  readonly fetchDailyBars: CoinbaseDailyBarFetcher;
  readonly maxDays: number;
  readonly nowMs: number;
  readonly minAlignedDays?: number;
  readonly policy?: AlignmentPolicy;
  readonly logger?: StructuredLogger;
  readonly metrics?: OperationalMetrics;
  readonly correlationId?: string;
}

export interface DecisionDatasetProvenance {
  readonly source: 'coinbase';
  readonly interval: '1d';
  readonly generatedAtMs: number;
  readonly requestedMaxDays: number;
  readonly fetchedBarsByAsset: Record<InstrumentKey, number>;
  readonly excludedIncompleteBarsByAsset: Record<InstrumentKey, number>;
  readonly retainedBarsByAsset: Record<InstrumentKey, number>;
  readonly firstAlignedInterval: string | null;
  readonly lastAlignedInterval: string | null;
  readonly datasetHash: string;
}

export type DecisionDatasetSyncFailureCode =
  | 'fetch_failed'
  | 'invalid_provider_data'
  | 'alignment_failed'
  | 'insufficient_history'
  | 'stale_data';

export type DecisionDatasetSyncResult =
  | {
      readonly ok: true;
      readonly dataset: DecisionMarketDataset;
      readonly provenance: DecisionDatasetProvenance;
    }
  | {
      readonly ok: false;
      readonly code: DecisionDatasetSyncFailureCode;
      readonly message: string;
      readonly failures?: ReadonlyArray<{
        instrument: InstrumentIdentity;
        status: number;
        reason: HttpFailure['reason'] | 'exception';
      }>;
      readonly alignmentReport?: AlignmentReport;
    };

function validateOptions(options: DecisionDatasetSyncOptions): void {
  if (!Number.isSafeInteger(options.maxDays) || options.maxDays <= 0) {
    throw new TypeError('maxDays must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(options.nowMs) || options.nowMs <= 0) {
    throw new TypeError('nowMs must be a positive safe integer.');
  }
  const minimum = options.minAlignedDays ?? 1;
  if (!Number.isSafeInteger(minimum) || minimum <= 0 || minimum > options.maxDays) {
    throw new TypeError('minAlignedDays must be between 1 and maxDays.');
  }
  if (options.instruments.length === 0) throw new TypeError('At least one instrument is required.');
}

function canonicalInstruments(values: readonly InstrumentIdentity[]): InstrumentIdentity[] {
  const result = new Map<InstrumentKey, InstrumentIdentity>();
  for (const instrument of values) {
    if (instrument.venue !== 'coinbase' || instrument.productType !== 'spot') {
      throw new TypeError('Decision datasets require Coinbase spot instruments.');
    }
    result.set(instrumentKey(instrument), instrument);
  }
  return [...result.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([, instrument]) => instrument);
}

function expandExponent(value: number): string {
  const text = String(value);
  const marker = text.search(/[eE]/);
  if (marker < 0) return text;
  const coefficient = text.slice(0, marker);
  const exponent = Number(text.slice(marker + 1));
  const negative = coefficient.startsWith('-');
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const point = unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const integerDigits = point < 0 ? unsigned.length : point;
  const decimalPosition = integerDigits + exponent;
  const expanded = decimalPosition <= 0
    ? `0.${'0'.repeat(-decimalPosition)}${digits}`
    : decimalPosition >= digits.length
      ? `${digits}${'0'.repeat(decimalPosition - digits.length)}`
      : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  return negative ? `-${expanded}` : expanded;
}

function storedRecord(bar: MarketBar, instrument: InstrumentIdentity): MarketBarRecord {
  return {
    source: bar.source,
    instrument,
    providerAssetId: instrument.productId,
    interval: bar.interval,
    startTimeMs: bar.startTimeMs,
    endTimeMs: bar.endTimeMs,
    open: expandExponent(bar.open),
    high: expandExponent(bar.high),
    low: expandExponent(bar.low),
    close: expandExponent(bar.close),
    volume: bar.volume === null ? null : expandExponent(bar.volume),
    isComplete: bar.isComplete,
    quality: bar.quality ?? 'reported_ohlc',
    retrievedAtMs: bar.retrievedAtMs,
  };
}

function coreBar(row: MarketBarRecord): MarketBar {
  return {
    assetId: instrumentKey(row.instrument),
    source: row.source,
    interval: row.interval,
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

function latestExpectedCompleteStart(nowMs: number): number {
  return Math.floor((nowMs - COINBASE_COMPLETION_DELAY_MS) / DAY_MS) * DAY_MS - DAY_MS;
}

function workflowLogger(options: DecisionDatasetSyncOptions): StructuredLogger {
  const context: Record<string, unknown> = { component: 'market-data.dataset' };
  if (options.correlationId) context['correlationId'] = options.correlationId;
  return (options.logger ?? NOOP_LOGGER).child(context);
}

function statusClass(status: number): string {
  return status >= 100 && status <= 599 ? `${Math.floor(status / 100)}xx` : 'none';
}

/** Fetch, atomically cache, align, freshness-check, and hash Coinbase daily bars. */
export async function syncCoinbaseDecisionDataset(
  options: DecisionDatasetSyncOptions,
): Promise<DecisionDatasetSyncResult> {
  validateOptions(options);
  const instruments = canonicalInstruments(options.instruments);
  const logger = workflowLogger(options);
  const metrics = (options.metrics ?? NOOP_METRICS).child({
    component: 'market_data_dataset', provider: 'coinbase',
  });
  const stopTimer = metrics.startTimer('market_data_job_duration_ms', {
    operation: 'dataset_sync',
  });
  let finished = false;
  const finish = (outcome: 'success' | 'failure', reason?: string): void => {
    if (finished) return;
    finished = true;
    const labels = reason === undefined
      ? { operation: 'dataset_sync', outcome }
      : { operation: 'dataset_sync', outcome, reason };
    metrics.counter('market_data_job_outcomes_total', 1, labels);
    stopTimer({ outcome, ...(reason === undefined ? {} : { reason }) });
  };
  logger.info('market_dataset.sync_started', {
    assetIds: instruments.map(instrumentKey),
    maxDays: options.maxDays,
    minAlignedDays: options.minAlignedDays ?? 1,
    policy: options.policy ?? 'reject-on-gap',
  });
  const fetchedBarsByAsset: Record<InstrumentKey, number> = {};
  const incompleteByAsset: Record<InstrumentKey, number> = {};
  const responses = await Promise.all(instruments.map(async (instrument) => {
    try {
      return { instrument, result: await options.fetchDailyBars(instrument, {
        maxDays: options.maxDays,
        nowMs: options.nowMs,
        retrievedAtMs: options.nowMs,
      }) };
    } catch {
      return { instrument, result: null };
    }
  }));
  const failures: Array<{
    instrument: InstrumentIdentity;
    status: number;
    reason: HttpFailure['reason'] | 'exception';
  }> = [];
  for (const { instrument, result } of responses) {
    if (result === null) {
      failures.push({ instrument, status: 0, reason: 'exception' });
      metrics.counter('market_data_provider_requests_total', 1, {
        operation: 'daily_bars', outcome: 'failure', reason: 'exception', status_class: 'none',
      });
    } else if (!result.ok) {
      failures.push({ instrument, status: result.status, reason: result.reason });
      metrics.counter('market_data_provider_requests_total', 1, {
        operation: 'daily_bars', outcome: 'failure', reason: result.reason,
        status_class: statusClass(result.status),
      });
      if (result.retried > 0) metrics.counter('market_data_provider_retries_total', result.retried, {
        operation: 'daily_bars', reason: result.reason,
      });
    } else {
      metrics.counter('market_data_provider_requests_total', 1, {
        operation: 'daily_bars', outcome: 'success', status_class: statusClass(result.status),
      });
    }
  }
  if (failures.length > 0) {
    logger.error('market_dataset.fetch_failed', {
      failures: failures.map(({ instrument, status, reason }) => ({
        assetId: instrumentKey(instrument), status, reason,
      })),
    });
    finish('failure', 'fetch_failed');
    return {
      ok: false, code: 'fetch_failed',
      message: 'Coinbase daily-bar fetch failed; no fetched rows were persisted.', failures,
    };
  }

  const records: MarketBarRecord[] = [];
  for (const response of responses) {
    if (!response.result?.ok) continue;
    const key = instrumentKey(response.instrument);
    fetchedBarsByAsset[key] = response.result.data.length;
    const complete = response.result.data.filter((bar) => bar.isComplete);
    incompleteByAsset[key] = response.result.data.length - complete.length;
    const invalidIdentity = response.result.data.some((bar) =>
      bar.source !== 'coinbase' || bar.assetId !== key || bar.interval !== '1d');
    const rawValidation = alignMarketBars({ [key]: response.result.data }, [key], {
      policy: 'intersection', nowMs: options.nowMs, expectedSource: 'coinbase',
    });
    const validation = alignMarketBars({ [key]: complete }, [key], {
      policy: 'reject-on-gap', nowMs: options.nowMs, expectedSource: 'coinbase',
    });
    const rawInvalid = rawValidation.report.issues.some((issue) => issue.code !== 'incomplete');
    if (invalidIdentity || rawInvalid || validation.report.issues.length > 0) {
      logger.error('market_dataset.provider_data_rejected', {
        assetId: key,
        invalidIdentity,
        issueCount: validation.report.issues.length,
      });
      metrics.gauge('market_data_dataset_issues', validation.report.issues.length, {
        operation: 'provider_validation', outcome: 'failure',
      });
      finish('failure', 'invalid_provider_data');
      return {
        ok: false, code: 'invalid_provider_data',
        message: `Coinbase returned invalid or discontinuous bars for ${response.instrument.productId}.`,
        alignmentReport: validation.report,
      };
    }
    records.push(...response.result.data.map((bar) => storedRecord(bar, response.instrument)));
  }
  upsertMarketBars(records, options.database);
  metrics.gauge('market_data_cached_bars', records.length, { operation: 'dataset_sync' });
  logger.debug('market_dataset.bars_persisted', { barCount: records.length });

  const cutoff = Math.floor(options.nowMs / DAY_MS) * DAY_MS - options.maxDays * DAY_MS;
  const input: Record<InstrumentKey, MarketBar[]> = {};
  for (const instrument of instruments) {
    const key = instrumentKey(instrument);
    input[key] = listMarketBars(instrument, options.database, 'coinbase')
      .filter((row) => row.startTimeMs >= cutoff && row.isComplete)
      .map(coreBar);
  }
  const requested = instruments.map(instrumentKey);
  const policy = options.policy ?? 'reject-on-gap';
  const dataset = buildDecisionMarketDataset(input, requested, {
    policy,
    nowMs: options.nowMs,
    expectedSource: 'coinbase',
  });
  if (
    dataset.dayKeys.length === 0 ||
    (policy !== 'intersection' && dataset.report.issues.length > 0)
  ) {
    logger.warn('market_dataset.alignment_failed', {
      alignedDayCount: dataset.dayKeys.length,
      issueCount: dataset.report.issues.length,
    });
    metrics.gauge('market_data_dataset_issues', dataset.report.issues.length, {
      operation: 'alignment', outcome: 'failure', policy,
    });
    finish('failure', 'alignment_failed');
    return {
      ok: false, code: 'alignment_failed',
      message: 'Completed Coinbase bars could not form a gap-free decision dataset.',
      alignmentReport: dataset.report,
    };
  }
  const minimum = options.minAlignedDays ?? 1;
  if (dataset.dayKeys.length < minimum) {
    logger.warn('market_dataset.insufficient_history', {
      alignedDayCount: dataset.dayKeys.length, requiredDayCount: minimum,
    });
    metrics.gauge('market_data_aligned_days', dataset.dayKeys.length, {
      operation: 'dataset_sync', outcome: 'failure', policy,
    });
    finish('failure', 'insufficient_history');
    return {
      ok: false, code: 'insufficient_history',
      message: `Only ${dataset.dayKeys.length} aligned days are available; ${minimum} are required.`,
      alignmentReport: dataset.report,
    };
  }
  const expectedLatest = latestExpectedCompleteStart(options.nowMs);
  if (dataset.assets.some((assetId) => dataset.barsById[assetId]?.at(-1)?.startTimeMs !== expectedLatest)) {
    logger.warn('market_dataset.stale_data', {
      expectedLatestStartMs: expectedLatest,
      lastAlignedInterval: dataset.report.lastAlignedInterval,
    });
    const latestEndMs = Math.max(...dataset.assets.map((assetId) =>
      dataset.barsById[assetId]?.at(-1)?.endTimeMs ?? 0));
    metrics.gauge('market_data_freshness_ms', Math.max(0, options.nowMs - latestEndMs), {
      operation: 'dataset_sync', outcome: 'failure', reason: 'stale_data',
    });
    finish('failure', 'stale_data');
    return {
      ok: false, code: 'stale_data',
      message: 'The latest expected completed Coinbase UTC bar is unavailable.',
      alignmentReport: dataset.report,
    };
  }
  const provenance: DecisionDatasetProvenance = {
    source: 'coinbase', interval: '1d', generatedAtMs: options.nowMs,
    requestedMaxDays: options.maxDays, fetchedBarsByAsset,
    excludedIncompleteBarsByAsset: incompleteByAsset,
    retainedBarsByAsset: dataset.report.retainedBarsByAsset,
    firstAlignedInterval: dataset.report.firstAlignedInterval,
    lastAlignedInterval: dataset.report.lastAlignedInterval,
    datasetHash: dataset.report.datasetHash,
  };
  logger.info('market_dataset.sync_succeeded', {
    assetCount: dataset.assets.length,
    alignedDayCount: dataset.dayKeys.length,
    firstAlignedInterval: provenance.firstAlignedInterval,
    lastAlignedInterval: provenance.lastAlignedInterval,
    datasetHash: provenance.datasetHash,
  });
  const latestEndMs = dataset.barsById[dataset.assets[0]!]?.at(-1)?.endTimeMs ?? options.nowMs;
  metrics.gauge('market_data_freshness_ms', Math.max(0, options.nowMs - latestEndMs), {
    operation: 'dataset_sync', outcome: 'success',
  });
  metrics.gauge('market_data_aligned_days', dataset.dayKeys.length, {
    operation: 'dataset_sync', outcome: 'success', policy,
  });
  finish('success');
  return { ok: true, dataset, provenance };
}
