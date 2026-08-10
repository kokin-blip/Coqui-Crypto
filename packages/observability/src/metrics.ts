export type MetricKind = 'counter' | 'gauge' | 'histogram';

export type MetricLabels = Readonly<Record<string, string>>;

export interface MetricObservation {
  readonly recordedAtMs: number;
  readonly name: string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly labels: MetricLabels;
}

export type MetricSink = (observation: MetricObservation) => void;

export interface OperationalMetricsOptions {
  readonly sink?: MetricSink;
  readonly labels?: MetricLabels;
  readonly clock?: () => number;
  readonly secrets?: readonly string[];
}

export interface OperationalMetrics {
  counter(name: string, value?: number, labels?: MetricLabels): void;
  gauge(name: string, value: number, labels?: MetricLabels): void;
  histogram(name: string, value: number, labels?: MetricLabels): void;
  startTimer(name: string, labels?: MetricLabels): (labels?: MetricLabels) => void;
  child(labels: MetricLabels): OperationalMetrics;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,99}$/u;
const LABEL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/u;
const LABEL_VALUE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
const MAX_LABELS = 8;
const ALLOWED_LABEL_KEYS = new Set([
  'component', 'created', 'operation', 'outcome', 'policy', 'provider', 'reason',
  'status_class',
]);

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new TypeError('Metric names must be stable lowercase identifiers of at most 100 characters.');
  }
}

function safeLabels(
  base: MetricLabels,
  extra: MetricLabels | undefined,
  secrets: readonly string[],
): MetricLabels | null {
  const merged = { ...base, ...(extra ?? {}) };
  const entries = Object.entries(merged).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > MAX_LABELS) return null;
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, value] of entries) {
    if (
      !ALLOWED_LABEL_KEYS.has(key) || !LABEL_KEY_PATTERN.test(key) ||
      !LABEL_VALUE_PATTERN.test(value) ||
      secrets.some((secret) => secret.length > 0 && (key.includes(secret) || value.includes(secret)))
    ) return null;
    result[key] = value;
  }
  return Object.freeze(result);
}

function validValue(kind: MetricKind, value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && (kind !== 'counter' || value > 0);
}

function recorder(options: Required<Pick<OperationalMetricsOptions, 'sink' | 'clock'>> & {
  readonly labels: MetricLabels;
  readonly secrets: readonly string[];
}): OperationalMetrics {
  const record = (
    kind: MetricKind,
    name: string,
    value: number,
    labels?: MetricLabels,
  ): void => {
    assertName(name);
    if (!validValue(kind, value)) {
      throw new RangeError('Metric values must be non-negative safe integers; counters must be positive.');
    }
    const boundedLabels = safeLabels(options.labels, labels, options.secrets);
    if (boundedLabels === null) return;
    try {
      const recordedAtMs = options.clock();
      if (!Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0) return;
      options.sink(Object.freeze({ recordedAtMs, name, kind, value, labels: boundedLabels }));
    } catch {
      // Metrics must never change application control flow.
    }
  };
  return Object.freeze({
    counter: (name: string, value = 1, labels?: MetricLabels) =>
      record('counter', name, value, labels),
    gauge: (name: string, value: number, labels?: MetricLabels) =>
      record('gauge', name, value, labels),
    histogram: (name: string, value: number, labels?: MetricLabels) =>
      record('histogram', name, value, labels),
    startTimer: (name: string, labels?: MetricLabels) => {
      assertName(name);
      let startedAtMs: number | null = null;
      try {
        const value = options.clock();
        if (Number.isSafeInteger(value) && value >= 0) startedAtMs = value;
      } catch {
        startedAtMs = null;
      }
      let stopped = false;
      return (completionLabels?: MetricLabels): void => {
        if (stopped || startedAtMs === null) return;
        stopped = true;
        let endedAtMs: number;
        try {
          endedAtMs = options.clock();
        } catch {
          return;
        }
        const duration = Math.max(0, Math.round(endedAtMs - startedAtMs));
        record('histogram', name, duration, { ...labels, ...completionLabels });
      };
    },
    child: (labels: MetricLabels) => {
      const bounded = safeLabels(options.labels, labels, options.secrets);
      return bounded === null ? NOOP_METRICS : recorder({ ...options, labels: bounded });
    },
  });
}

const EMPTY_LABELS = Object.freeze({});

/** Create bounded low-cardinality metrics with failure-isolated delivery. */
export function createOperationalMetrics(
  options: OperationalMetricsOptions = {},
): OperationalMetrics {
  return recorder({
    sink: options.sink ?? (() => undefined),
    clock: options.clock ?? Date.now,
    labels: options.labels ?? EMPTY_LABELS,
    secrets: Object.freeze([...(options.secrets ?? [])]),
  });
}

export const NOOP_METRICS: OperationalMetrics = createOperationalMetrics();
