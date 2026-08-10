import type { HttpFailure, HttpResult } from '@coqui/adapters';
import {
  buildPointInTimeUniverseTimeline,
  createPointInTimeUniverseSnapshot,
  sha256Hex,
  type DecisionMarketDataset,
  type InstrumentKey,
  type PointInTimeUniverseSnapshot,
  type PointInTimeUniverseTimeline,
  type UniverseProductObservation,
} from '@coqui/core';
import {
  listUniverseSnapshots,
  saveUniverseSnapshot,
  type Db,
} from '@coqui/storage';
import {
  NOOP_LOGGER,
  NOOP_METRICS,
  type OperationalMetrics,
  type StructuredLogger,
} from '@coqui/observability';

export type CoinbaseUniverseFetcher = () => Promise<HttpResult<UniverseProductObservation[]>>;

export interface UniverseCaptureOptions {
  readonly database: Db;
  readonly observedAtMs: number;
  readonly fetchProducts: CoinbaseUniverseFetcher;
  readonly logger?: StructuredLogger;
  readonly metrics?: OperationalMetrics;
  readonly correlationId?: string;
}

export type UniverseCaptureResult =
  | { readonly ok: true; readonly created: boolean; readonly snapshot: PointInTimeUniverseSnapshot }
  | {
      readonly ok: false;
      readonly code: 'fetch_failed';
      readonly status: number;
      readonly reason: HttpFailure['reason'] | 'exception';
      readonly message: string;
    };

export interface UniverseBoundDecisionDataset {
  readonly dataset: DecisionMarketDataset;
  readonly universe: PointInTimeUniverseTimeline;
  readonly eligibleDatasetAssetsByDay: Readonly<Record<string, readonly InstrumentKey[]>>;
  readonly decisionContextHash: string;
}

export type BindUniverseResult =
  | { readonly ok: true; readonly value: UniverseBoundDecisionDataset }
  | {
      readonly ok: false;
      readonly code: 'uncovered_universe_days';
      readonly uncoveredDayKeys: readonly string[];
      readonly message: string;
    };

/** Capture a complete public Coinbase product response as one immutable snapshot. */
export async function captureCoinbaseUniverseSnapshot(
  options: UniverseCaptureOptions,
): Promise<UniverseCaptureResult> {
  const context: Record<string, unknown> = { component: 'market-data.universe' };
  if (options.correlationId) context['correlationId'] = options.correlationId;
  const logger = (options.logger ?? NOOP_LOGGER).child(context);
  const metrics = (options.metrics ?? NOOP_METRICS).child({
    component: 'market_data_universe', provider: 'coinbase',
  });
  const stopTimer = metrics.startTimer('market_data_job_duration_ms', {
    operation: 'universe_capture',
  });
  logger.info('market_universe.capture_started', { observedAtMs: options.observedAtMs });
  let result: HttpResult<UniverseProductObservation[]>;
  try {
    result = await options.fetchProducts();
  } catch {
    logger.error('market_universe.fetch_failed', { status: 0, reason: 'exception' });
    metrics.counter('market_data_provider_requests_total', 1, {
      operation: 'products', outcome: 'failure', reason: 'exception', status_class: 'none',
    });
    metrics.counter('market_data_job_outcomes_total', 1, {
      operation: 'universe_capture', outcome: 'failure', reason: 'fetch_failed',
    });
    stopTimer({ outcome: 'failure', reason: 'fetch_failed' });
    return {
      ok: false, code: 'fetch_failed', status: 0, reason: 'exception',
      message: 'Coinbase universe fetch threw; no snapshot was persisted.',
    };
  }
  if (!result.ok) {
    logger.error('market_universe.fetch_failed', {
      status: result.status, reason: result.reason, retried: result.retried,
    });
    metrics.counter('market_data_provider_requests_total', 1, {
      operation: 'products', outcome: 'failure', reason: result.reason,
      status_class: result.status >= 100 && result.status <= 599
        ? `${Math.floor(result.status / 100)}xx`
        : 'none',
    });
    if (result.retried > 0) metrics.counter('market_data_provider_retries_total', result.retried, {
      operation: 'products', reason: result.reason,
    });
    metrics.counter('market_data_job_outcomes_total', 1, {
      operation: 'universe_capture', outcome: 'failure', reason: 'fetch_failed',
    });
    stopTimer({ outcome: 'failure', reason: 'fetch_failed' });
    return {
      ok: false, code: 'fetch_failed', status: result.status, reason: result.reason,
      message: 'Coinbase universe fetch failed; no snapshot was persisted.',
    };
  }
  const snapshot = createPointInTimeUniverseSnapshot(options.observedAtMs, result.data);
  const created = saveUniverseSnapshot(snapshot, options.database);
  metrics.counter('market_data_provider_requests_total', 1, {
    operation: 'products', outcome: 'success', status_class: `${Math.floor(result.status / 100)}xx`,
  });
  metrics.gauge('market_data_universe_products', snapshot.products.length, {
    operation: 'universe_capture', created: String(created),
  });
  metrics.counter('market_data_job_outcomes_total', 1, {
    operation: 'universe_capture', outcome: 'success',
  });
  stopTimer({ outcome: 'success' });
  logger.info('market_universe.capture_succeeded', {
    created,
    productCount: snapshot.products.length,
    effectiveFromDayKey: snapshot.effectiveFromDayKey,
    snapshotHash: snapshot.snapshotHash,
  });
  return { ok: true, created, snapshot };
}

export function loadPointInTimeUniverse(
  database: Db,
  dayKeys: readonly string[],
): PointInTimeUniverseTimeline {
  return buildPointInTimeUniverseTimeline(listUniverseSnapshots(database), dayKeys);
}

/**
 * Bind only contemporaneously observed membership to a dataset. Historical days
 * without a prior-day snapshot fail instead of inheriting today's survivors.
 */
export function bindPointInTimeUniverse(
  dataset: DecisionMarketDataset,
  database: Db,
  metrics: OperationalMetrics = NOOP_METRICS,
): BindUniverseResult {
  const universe = loadPointInTimeUniverse(database, dataset.dayKeys);
  const boundedMetrics = metrics.child({ component: 'market_data_universe' });
  boundedMetrics.gauge('market_data_universe_uncovered_days', universe.uncoveredDayKeys.length, {
    operation: 'universe_bind',
  });
  if (universe.uncoveredDayKeys.length > 0) {
    boundedMetrics.counter('market_data_job_outcomes_total', 1, {
      operation: 'universe_bind', outcome: 'failure', reason: 'uncovered_days',
    });
    return {
      ok: false,
      code: 'uncovered_universe_days',
      uncoveredDayKeys: universe.uncoveredDayKeys,
      message: 'Point-in-time universe coverage is incomplete; the dataset cannot support universe research.',
    };
  }
  const requested = new Set(dataset.assets);
  const eligibleDatasetAssetsByDay: Record<string, InstrumentKey[]> = {};
  for (const dayKey of dataset.dayKeys) {
    eligibleDatasetAssetsByDay[dayKey] = (universe.membershipsByDay[dayKey]?.eligibleAssets ?? [])
      .filter((assetId) => requested.has(assetId));
  }
  const decisionContextHash = sha256Hex(JSON.stringify({
    datasetHash: dataset.report.datasetHash,
    universeTimelineHash: universe.timelineHash,
    eligibleDatasetAssetsByDay,
  }));
  boundedMetrics.counter('market_data_job_outcomes_total', 1, {
    operation: 'universe_bind', outcome: 'success',
  });
  return {
    ok: true,
    value: deepFreeze({ dataset, universe, eligibleDatasetAssetsByDay, decisionContextHash }),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
