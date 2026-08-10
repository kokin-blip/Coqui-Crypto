import { describe, expect, it, vi } from 'vitest';

import {
  createOperationalMetrics,
  type MetricObservation,
} from '../packages/observability/src/index.js';
import {
  listOperationalMetrics,
  openDatabase,
  saveOperationalMetric,
} from '../packages/storage/src/index.js';

describe('operational metrics', () => {
  it('records canonical low-cardinality counters, gauges, and durations', () => {
    const observations: MetricObservation[] = [];
    const times = [100, 110, 145];
    const metrics = createOperationalMetrics({
      sink: (observation) => observations.push(observation),
      clock: () => times.shift() ?? 145,
      labels: { component: 'market_data' },
    });

    metrics.counter('provider_requests_total', 2, {
      outcome: 'success', provider: 'coinbase',
    });
    const stop = metrics.startTimer('job_duration_ms', { operation: 'dataset_sync' });
    stop({ outcome: 'success' });
    stop({ outcome: 'failure' });

    expect(observations).toEqual([
      {
        recordedAtMs: 100,
        name: 'provider_requests_total',
        kind: 'counter',
        value: 2,
        labels: { component: 'market_data', outcome: 'success', provider: 'coinbase' },
      },
      {
        recordedAtMs: 145,
        name: 'job_duration_ms',
        kind: 'histogram',
        value: 35,
        labels: { component: 'market_data', operation: 'dataset_sync', outcome: 'success' },
      },
    ]);
  });

  it('drops unsafe labels and contains sink or clock failures', () => {
    const secret = 'metric-canary-secret';
    const sink = vi.fn(() => { throw new Error('database unavailable'); });
    const metrics = createOperationalMetrics({ sink, secrets: [secret] });

    expect(() => metrics.counter('requests_total', 1, { reason: secret })).not.toThrow();
    expect(sink).not.toHaveBeenCalled();
    expect(() => metrics.counter('requests_total', 1, {
      reason: 'https://example.test/private',
    })).not.toThrow();
    expect(sink).not.toHaveBeenCalled();
    expect(() => metrics.gauge('queue_depth', 1, { provider: 'coinbase' })).not.toThrow();
    expect(sink).toHaveBeenCalledOnce();

    const brokenClock = createOperationalMetrics({
      sink,
      clock: () => { throw new Error('clock unavailable'); },
    });
    expect(() => brokenClock.gauge('queue_depth', 1)).not.toThrow();
  });

  it('persists observations across repository reads and enforces retention', () => {
    const database = openDatabase(':memory:');
    const metrics = createOperationalMetrics({
      clock: () => 200,
      sink: (observation) => saveOperationalMetric(observation, database, 100),
    });
    saveOperationalMetric({
      recordedAtMs: 50,
      name: 'old_metric',
      kind: 'gauge',
      value: 1,
      labels: { component: 'test' },
    }, database, 100);
    metrics.gauge('current_metric', 7, { component: 'test' });

    expect(listOperationalMetrics(database)).toEqual([{
      recordedAtMs: 200,
      name: 'current_metric',
      kind: 'gauge',
      value: 7,
      labels: { component: 'test' },
    }]);
    database.close();
  });

  it('rejects unstable names and unbounded values before persistence', () => {
    const metrics = createOperationalMetrics();
    expect(() => metrics.counter('Contains spaces')).toThrow(TypeError);
    expect(() => metrics.counter('requests_total', 0)).toThrow(RangeError);
    expect(() => metrics.gauge('queue_depth', Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
