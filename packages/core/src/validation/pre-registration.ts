import { sha256Hex } from '../crypto/sha256.js';
import type { JsonValue, StrategyFamily } from '../trials/index.js';

const DAY_MS = 86_400_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const STUDY_REF_PATTERN = /^docs\/studies\/[a-zA-Z0-9._/-]+\.md$/u;
const STRATEGY_FAMILIES: readonly StrategyFamily[] = [
  'momentum', 'voltarget', 'trendvol', 'signal-tilt', 'rotation',
];

export interface ChronologicalWindow {
  readonly startMs: number;
  readonly endExclusiveMs: number;
}

export interface ChronologicalValidationPlan {
  readonly development: ChronologicalWindow;
  readonly holdout: ChronologicalWindow;
  readonly nestedFoldCount: number;
  readonly embargoDays: number;
  readonly minimumDevelopmentBars: number;
  readonly minimumHoldoutBars: number;
  readonly cscvPartitionCount: number;
  readonly bootstrapResamples: number;
  readonly bootstrapMeanBlockLength: number;
  readonly bootstrapConfidenceLevel: number;
  readonly bootstrapSeed: number;
}

export interface ResearchAdoptionRules {
  readonly minimumDeflatedSharpeProbability: number;
  readonly requirePositiveExcessReturnVsHold: true;
  readonly requirePositiveExcessReturnVsPassive: true;
  readonly rejectIfSignificanceUnavailable: true;
  readonly maximumDrawdownPct: number;
  readonly maximumProbabilityOfBacktestOverfitting: number;
}

export interface ResearchExecutionPlan {
  readonly baseTargets: readonly {
    readonly assetId: string;
    readonly weight: number;
  }[];
  readonly warmupBars: number;
  readonly cashAprPct: number;
}

/** Immutable declaration made before a parameter grid is evaluated. */
export interface ResearchPreRegistration {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly registeredAt: string;
  readonly family: StrategyFamily;
  readonly hypothesis: string;
  readonly parameterSpace: Readonly<Record<string, readonly JsonValue[]>>;
  readonly candidateCount: number;
  readonly datasetHash: string;
  readonly costProfileHash: string;
  readonly codeRevision: string;
  readonly execution: ResearchExecutionPlan;
  readonly validation: ChronologicalValidationPlan;
  readonly primaryMetric: 'after-cost-excess-return-vs-hold';
  readonly adoptionRules: ResearchAdoptionRules;
  readonly studyRef: string;
}

function validateJson(value: JsonValue): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Pre-registration JSON cannot contain non-finite numbers.');
  }
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (key.length === 0) throw new TypeError('Pre-registration JSON keys cannot be empty.');
      validateJson(item);
    }
  }
}

function validateWindow(name: string, window: ChronologicalWindow): void {
  for (const value of [window.startMs, window.endExclusiveMs]) {
    if (!Number.isSafeInteger(value) || value < 0 || value % DAY_MS !== 0) {
      throw new TypeError(`${name} boundaries must be non-negative UTC midnight timestamps.`);
    }
  }
  if (window.startMs >= window.endExclusiveMs) {
    throw new RangeError(`${name} must have positive duration.`);
  }
}

/** Exact number of candidates in a grid, with overflow rejection. */
export function gridCandidateCount(
  parameterSpace: Readonly<Record<string, readonly JsonValue[]>>,
): number {
  const entries = Object.entries(parameterSpace);
  if (entries.length === 0) throw new TypeError('A pre-registered grid cannot be empty.');
  let count = 1;
  for (const [parameter, values] of entries) {
    if (parameter.length === 0 || values.length === 0) {
      throw new TypeError('Every pre-registered parameter needs at least one value.');
    }
    const uniqueValues = new Set<string>();
    for (const value of values) {
      validateJson(value);
      uniqueValues.add(JSON.stringify(canonical(value)));
    }
    if (uniqueValues.size !== values.length) {
      throw new TypeError(`Pre-registered parameter contains duplicate values: ${parameter}`);
    }
    count *= values.length;
    if (!Number.isSafeInteger(count)) throw new RangeError('Candidate count exceeds safe integer range.');
  }
  return count;
}

/** Fail closed when a study leaves dates, search budget, costs, or adoption vague. */
export function validateResearchPreRegistration(plan: ResearchPreRegistration): void {
  if (plan.schemaVersion !== 1) throw new TypeError('Unsupported pre-registration schema version.');
  if (plan.id.length === 0 || plan.id.length > 200) throw new TypeError('Invalid pre-registration id.');
  if (!STRATEGY_FAMILIES.includes(plan.family)) {
    throw new TypeError('Unsupported pre-registration strategy family.');
  }
  if (plan.hypothesis.trim().length === 0 || plan.hypothesis.length > 2_000) {
    throw new TypeError('A concise, explicit research hypothesis is required.');
  }
  const registeredAt = new Date(plan.registeredAt);
  if (Number.isNaN(registeredAt.valueOf()) || registeredAt.toISOString() !== plan.registeredAt) {
    throw new TypeError('registeredAt must be a canonical ISO-8601 timestamp.');
  }
  if (registeredAt.valueOf() < 0) throw new TypeError('registeredAt cannot predate the Unix epoch.');
  if (!HASH_PATTERN.test(plan.datasetHash) || !HASH_PATTERN.test(plan.costProfileHash)) {
    throw new TypeError('Pre-registration requires lowercase SHA-256 dataset and cost hashes.');
  }
  if (plan.codeRevision.length === 0 || plan.codeRevision.length > 200) {
    throw new TypeError('Pre-registration requires an explicit code revision.');
  }
  if (!Number.isSafeInteger(plan.execution.warmupBars) || plan.execution.warmupBars < 2) {
    throw new RangeError('Research execution requires at least two warmup bars.');
  }
  if (!Number.isFinite(plan.execution.cashAprPct) || plan.execution.cashAprPct < 0) {
    throw new RangeError('Research cash APR must be finite and non-negative.');
  }
  if (plan.execution.baseTargets.length === 0) {
    throw new TypeError('Research execution requires at least one base target.');
  }
  const targetIds = new Set<string>();
  let targetWeight = 0;
  for (const target of plan.execution.baseTargets) {
    if (!/^(?:coinbase|binance|kraken)\|spot\|[^|]+$/u.test(target.assetId) ||
        targetIds.has(target.assetId)) {
      throw new TypeError('Base targets require unique canonical instrument keys.');
    }
    if (!Number.isFinite(target.weight) || target.weight <= 0 || target.weight > 1) {
      throw new RangeError('Base-target weights must be in (0, 1].');
    }
    targetIds.add(target.assetId);
    targetWeight += target.weight;
  }
  if (Math.abs(targetWeight - 1) > 1e-12) {
    throw new RangeError('Base-target weights must sum to exactly one.');
  }
  if (!STUDY_REF_PATTERN.test(plan.studyRef)) {
    throw new TypeError('Pre-registration must link to a Markdown file under docs/studies.');
  }
  if (gridCandidateCount(plan.parameterSpace) !== plan.candidateCount) {
    throw new RangeError('Declared candidate count does not match the parameter grid.');
  }
  validateWindow('Development window', plan.validation.development);
  validateWindow('Holdout window', plan.validation.holdout);
  if (plan.validation.development.endExclusiveMs > plan.validation.holdout.startMs) {
    throw new RangeError('Development and holdout windows must be chronological and non-overlapping.');
  }
  if (!Number.isSafeInteger(plan.validation.nestedFoldCount) || plan.validation.nestedFoldCount < 3) {
    throw new RangeError('Nested validation requires at least three folds.');
  }
  if (!Number.isSafeInteger(plan.validation.embargoDays) || plan.validation.embargoDays < 0) {
    throw new RangeError('Embargo days must be a non-negative safe integer.');
  }
  for (const [name, value] of [
    ['minimumDevelopmentBars', plan.validation.minimumDevelopmentBars],
    ['minimumHoldoutBars', plan.validation.minimumHoldoutBars],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer.`);
    }
  }
  if (!Number.isSafeInteger(plan.validation.cscvPartitionCount) ||
      plan.validation.cscvPartitionCount < 4 ||
      plan.validation.cscvPartitionCount > 18 ||
      plan.validation.cscvPartitionCount % 2 !== 0) {
    throw new RangeError('CSCV requires an even partition count from 4 through 18.');
  }
  if (!Number.isSafeInteger(plan.validation.bootstrapResamples) ||
      plan.validation.bootstrapResamples < 500 ||
      plan.validation.bootstrapResamples > 100_000) {
    throw new RangeError('Benchmark uncertainty requires 500 through 100,000 resamples.');
  }
  if (!Number.isSafeInteger(plan.validation.bootstrapMeanBlockLength) ||
      plan.validation.bootstrapMeanBlockLength < 1) {
    throw new RangeError('Bootstrap mean block length must be a positive safe integer.');
  }
  if (!Number.isFinite(plan.validation.bootstrapConfidenceLevel) ||
      plan.validation.bootstrapConfidenceLevel <= 0.5 ||
      plan.validation.bootstrapConfidenceLevel >= 1) {
    throw new RangeError('Bootstrap confidence level must be between 0.5 and one.');
  }
  if (!Number.isSafeInteger(plan.validation.bootstrapSeed) ||
      plan.validation.bootstrapSeed < 0 ||
      plan.validation.bootstrapSeed > 0xffff_ffff) {
    throw new RangeError('Bootstrap seed must be an unsigned 32-bit integer.');
  }
  if (plan.primaryMetric !== 'after-cost-excess-return-vs-hold') {
    throw new TypeError('Unsupported primary research metric.');
  }
  const rules = plan.adoptionRules;
  if (!Number.isFinite(rules.minimumDeflatedSharpeProbability) ||
      rules.minimumDeflatedSharpeProbability <= 0 ||
      rules.minimumDeflatedSharpeProbability >= 1) {
    throw new RangeError('Minimum deflated-Sharpe probability must be between zero and one.');
  }
  if (!Number.isFinite(rules.maximumDrawdownPct) ||
      rules.maximumDrawdownPct <= 0 || rules.maximumDrawdownPct > 100) {
    throw new RangeError('Maximum drawdown must be in (0, 100].');
  }
  if (!Number.isFinite(rules.maximumProbabilityOfBacktestOverfitting) ||
      rules.maximumProbabilityOfBacktestOverfitting <= 0 ||
      rules.maximumProbabilityOfBacktestOverfitting >= 1) {
    throw new RangeError('Maximum PBO must be between zero and one.');
  }
  if (rules.requirePositiveExcessReturnVsHold !== true ||
      rules.requirePositiveExcessReturnVsPassive !== true ||
      rules.rejectIfSignificanceUnavailable !== true) {
    throw new TypeError('Required benchmark and significance gates cannot be disabled.');
  }
}

function canonical(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  }
  throw new TypeError('Pre-registration must be JSON-serializable.');
}

export function canonicalResearchPreRegistration(plan: ResearchPreRegistration): string {
  validateResearchPreRegistration(plan);
  return JSON.stringify(canonical(plan));
}

/** Stable identity that evidence can bind to after the untouched holdout is opened. */
export function researchPreRegistrationHash(plan: ResearchPreRegistration): string {
  return sha256Hex(canonicalResearchPreRegistration(plan));
}
