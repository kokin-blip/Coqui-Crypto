import { inTransaction, type Db } from '../sqlite/index.js';

export type StoredMetricKind = 'counter' | 'gauge' | 'histogram';

export interface StoredMetricObservation {
  readonly recordedAtMs: number;
  readonly name: string;
  readonly kind: StoredMetricKind;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
}

export interface OperationalMetricQuery {
  readonly name?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
}

interface MetricRow {
  recorded_at_ms: number;
  name: string;
  kind: string;
  value: number;
  labels_json: string;
}

export const DEFAULT_METRIC_RETENTION_MS = 90 * 86_400_000;
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,99}$/u;
const LABEL_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/u;
const LABEL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/u;

function validateObservation(observation: StoredMetricObservation): void {
  if (!Number.isSafeInteger(observation.recordedAtMs) || observation.recordedAtMs < 0) {
    throw new TypeError('Metric observation time must be a non-negative safe integer.');
  }
  if (!NAME_PATTERN.test(observation.name)) throw new TypeError('Invalid metric name.');
  if (!['counter', 'gauge', 'histogram'].includes(observation.kind)) {
    throw new TypeError('Invalid metric kind.');
  }
  if (!Number.isSafeInteger(observation.value) || observation.value < 0) {
    throw new TypeError('Metric value must be a non-negative safe integer.');
  }
  const entries = Object.entries(observation.labels);
  if (entries.length > 8 || entries.some(([key, value]) =>
    !LABEL_KEY_PATTERN.test(key) || !LABEL_PATTERN.test(value))) {
    throw new TypeError('Metric labels must be bounded low-cardinality identifiers.');
  }
}

function labelsJson(labels: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function rowToObservation(row: MetricRow): StoredMetricObservation {
  const labels: unknown = JSON.parse(row.labels_json);
  if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) {
    throw new Error('Stored metric labels are invalid.');
  }
  const observation: StoredMetricObservation = {
    recordedAtMs: row.recorded_at_ms,
    name: row.name,
    kind: row.kind as StoredMetricKind,
    value: row.value,
    labels: labels as Readonly<Record<string, string>>,
  };
  validateObservation(observation);
  if (labelsJson(observation.labels) !== row.labels_json) {
    throw new Error('Stored metric labels are not canonical.');
  }
  return Object.freeze({ ...observation, labels: Object.freeze({ ...observation.labels }) });
}

/** Persist one observation and prune rows outside the configured local window. */
export function saveOperationalMetric(
  observation: StoredMetricObservation,
  database: Db,
  retentionMs = DEFAULT_METRIC_RETENTION_MS,
): void {
  validateObservation(observation);
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) {
    throw new TypeError('Metric retention must be a positive safe integer.');
  }
  const serializedLabels = labelsJson(observation.labels);
  inTransaction(database, () => {
    database.prepare(
      `INSERT INTO operational_metric_observations
       (recorded_at_ms, name, kind, value, labels_json) VALUES (?, ?, ?, ?, ?)`,
    ).run(observation.recordedAtMs, observation.name, observation.kind,
      observation.value, serializedLabels);
    database.prepare(
      'DELETE FROM operational_metric_observations WHERE recorded_at_ms < ?',
    ).run(observation.recordedAtMs - retentionMs);
  });
}

/** Read a bounded newest-first diagnostic window. */
export function listOperationalMetrics(
  database: Db,
  query: OperationalMetricQuery = {},
): StoredMetricObservation[] {
  const limit = query.limit ?? 1_000;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 10_000) {
    throw new TypeError('Metric query limit must be between 1 and 10,000.');
  }
  const clauses: string[] = [];
  const parameters: Array<string | number> = [];
  if (query.name !== undefined) {
    if (!NAME_PATTERN.test(query.name)) throw new TypeError('Invalid metric query name.');
    clauses.push('name = ?');
    parameters.push(query.name);
  }
  if (query.fromMs !== undefined) {
    if (!Number.isSafeInteger(query.fromMs) || query.fromMs < 0) throw new TypeError('Invalid fromMs.');
    clauses.push('recorded_at_ms >= ?');
    parameters.push(query.fromMs);
  }
  if (query.toMs !== undefined) {
    if (!Number.isSafeInteger(query.toMs) || query.toMs < 0) throw new TypeError('Invalid toMs.');
    clauses.push('recorded_at_ms <= ?');
    parameters.push(query.toMs);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = database.prepare(
    `SELECT recorded_at_ms, name, kind, value, labels_json
     FROM operational_metric_observations ${where}
     ORDER BY recorded_at_ms DESC, id DESC LIMIT ?`,
  ).all(...parameters, limit) as unknown as MetricRow[];
  return rows.map(rowToObservation);
}
