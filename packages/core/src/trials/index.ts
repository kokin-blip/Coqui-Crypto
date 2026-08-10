import { sha256Hex } from '../crypto/sha256.js';

export type StrategyFamily = 'momentum' | 'voltarget' | 'trendvol' | 'signal-tilt' | 'rotation';
export type SearchKind = 'grid' | 'random' | 'bayesian' | 'human-guided' | 'feature-screen' | 'other';
export type TrialEvidenceStatus = 'verified' | 'legacy-unresolved';
export type TrialRegistryCompleteness = 'complete' | 'known-lower-bound';
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface TrialRecord {
  readonly id: string;
  readonly family: StrategyFamily;
  readonly searchKind: SearchKind;
  readonly evidenceStatus: TrialEvidenceStatus;
  readonly parameterSpace: Readonly<Record<string, readonly JsonValue[]>>;
  readonly trialCount: number;
  readonly searchedAt: string;
  readonly datasetHash: string | null;
  readonly costProfileHash: string | null;
  readonly codeRevision: string;
  readonly producedDefaults: Readonly<Record<string, JsonValue>>;
  readonly studyRef: string;
}

export interface TrialRegistrySnapshot {
  readonly schemaVersion: 2;
  readonly completeness: TrialRegistryCompleteness;
  readonly records: readonly TrialRecord[];
}

const DATASET_HASH_PATTERN = /^[a-f0-9]{64}$/;
const STUDY_REF_PATTERN = /^docs\/studies\/[a-zA-Z0-9._/-]+\.md$/;
const STRATEGY_FAMILIES: readonly StrategyFamily[] = [
  'momentum', 'voltarget', 'trendvol', 'signal-tilt', 'rotation',
];
const SEARCH_KINDS: readonly SearchKind[] = [
  'grid', 'random', 'bayesian', 'human-guided', 'feature-screen', 'other',
];

/** Create the only valid empty registry state. */
export function createTrialRegistry(
  completeness: TrialRegistryCompleteness = 'complete',
): TrialRegistrySnapshot {
  return { schemaVersion: 2, completeness, records: [] };
}

function validateJson(value: JsonValue): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Trial provenance JSON cannot contain non-finite numbers');
  }
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key.length === 0) throw new TypeError('Trial provenance JSON keys cannot be empty');
      validateJson(item);
    }
  }
}

function validateRecord(record: TrialRecord): void {
  if (record.id.length === 0) throw new TypeError('A trial record id cannot be empty');
  if (!STRATEGY_FAMILIES.includes(record.family) || !SEARCH_KINDS.includes(record.searchKind)) {
    throw new TypeError('A trial record has an unsupported family or search kind');
  }
  if (record.evidenceStatus !== 'verified' && record.evidenceStatus !== 'legacy-unresolved') {
    throw new TypeError('A trial record has an unsupported evidence status');
  }
  if (!Number.isSafeInteger(record.trialCount) || record.trialCount <= 0) {
    throw new RangeError('A trial count must be a positive safe integer');
  }
  if (record.codeRevision.length === 0 || record.codeRevision.length > 200) {
    throw new TypeError('A trial record requires an explicit code revision');
  }
  if (record.evidenceStatus === 'verified') {
    if (record.datasetHash === null || !DATASET_HASH_PATTERN.test(record.datasetHash)) {
      throw new TypeError('Verified trials require a lowercase SHA-256 dataset hash');
    }
    if (record.costProfileHash === null || !DATASET_HASH_PATTERN.test(record.costProfileHash)) {
      throw new TypeError('Verified trials require a lowercase SHA-256 cost-profile hash');
    }
  } else if (
    (record.datasetHash !== null && !DATASET_HASH_PATTERN.test(record.datasetHash)) ||
    (record.costProfileHash !== null && !DATASET_HASH_PATTERN.test(record.costProfileHash))
  ) {
    throw new TypeError('Legacy trial hashes must be null or lowercase SHA-256 values');
  }
  if (!STUDY_REF_PATTERN.test(record.studyRef)) {
    throw new TypeError('A trial record must link to a Markdown file under docs/studies');
  }
  const parsedTime = new Date(record.searchedAt);
  if (Number.isNaN(parsedTime.valueOf()) || parsedTime.toISOString() !== record.searchedAt) {
    throw new TypeError('searchedAt must be a canonical ISO-8601 timestamp');
  }
  for (const [parameter, values] of Object.entries(record.parameterSpace)) {
    if (parameter.length === 0 || values.length === 0) {
      throw new TypeError('Every searched parameter must name at least one candidate value');
    }
    for (const value of values) validateJson(value);
  }
  for (const value of Object.values(record.producedDefaults)) validateJson(value);
}

/** Append one immutable search record. There is intentionally no update or delete operation. */
export function registerTrials(
  registry: TrialRegistrySnapshot,
  record: TrialRecord,
): TrialRegistrySnapshot {
  if (registry.schemaVersion !== 2) throw new TypeError('Unsupported TrialRegistry schema version');
  if (registry.completeness !== 'complete' && registry.completeness !== 'known-lower-bound') {
    throw new TypeError('Unsupported TrialRegistry completeness');
  }
  validateRecord(record);
  if (registry.records.some((existing) => existing.id === record.id)) {
    throw new TypeError(`Trial record id already exists: ${record.id}`);
  }
  return {
    schemaVersion: 2,
    completeness: registry.completeness,
    records: [...registry.records, record],
  };
}

/** Total historical search budget that must reach deflated-Sharpe calculations. */
export function registeredTrialCount(
  registry: TrialRegistrySnapshot,
  family: StrategyFamily,
): number {
  const total = registry.records
    .filter((record) => record.family === family)
    .reduce((sum, record) => sum + record.trialCount, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError('Registered trial count exceeds safe integer range');
  return total;
}

/** Total search budget across every strategy family represented by a backtest scoreboard. */
export function totalRegisteredTrialCount(registry: TrialRegistrySnapshot): number {
  const total = registry.records.reduce((sum, record) => sum + record.trialCount, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError('Registered trial count exceeds safe integer range');
  return total;
}

/** Return a DSR search budget only when the historical audit is complete. */
export function trialCountForSignificance(registry: TrialRegistrySnapshot): number | null {
  return registry.completeness === 'complete' ? totalRegisteredTrialCount(registry) : null;
}

/** Count searches backed by immutable dataset and cost-profile hashes. */
export function verifiedTrialCount(
  registry: TrialRegistrySnapshot,
  family?: StrategyFamily,
): number {
  const total = registry.records
    .filter((record) => record.evidenceStatus === 'verified' &&
      (family === undefined || record.family === family))
    .reduce((sum, record) => sum + record.trialCount, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError('Verified trial count exceeds safe integer range');
  return total;
}

function canonical(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  }
  throw new TypeError('Trial provenance must be JSON-serializable');
}

/** Stable identity for one validated search record. */
export function trialRecordHash(record: TrialRecord): string {
  validateRecord(record);
  return sha256Hex(JSON.stringify(canonical(record)));
}

/** Stable identity for the complete registered search history. */
export function trialRegistryHash(registry: TrialRegistrySnapshot): string {
  if (registry.schemaVersion !== 2) throw new TypeError('Unsupported TrialRegistry schema version');
  const records = [...registry.records].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0).map((record) => canonical(record));
  return sha256Hex(JSON.stringify({
    schemaVersion: 2, completeness: registry.completeness, records,
  }));
}

/** Refuse significance calculations for defaults without registered search provenance. */
export function requireRegisteredTrials(
  registry: TrialRegistrySnapshot,
  family: StrategyFamily,
): number {
  const count = registeredTrialCount(registry, family);
  if (count === 0) throw new TypeError(`No registered trials exist for strategy family: ${family}`);
  return count;
}
