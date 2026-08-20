import {
  decimal,
  nonNegativeDecimal,
  type DecimalString,
  type InstrumentKey,
  type UsdAmount,
} from '../types/index.js';

const DAY_MS = 86_400_000;
const CANONICAL_INSTRUMENT = /^(?:coinbase|binance|kraken)\|spot\|[^|]+$/u;

export type PortfolioValuationStatus =
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'legacy_unverified';

/** Immutable daily valuation fact. Incomplete values never masquerade as equity. */
export interface PortfolioEvidenceSnapshot {
  readonly id: string;
  readonly dayKeyMs: number;
  readonly scheduledForMs: number;
  readonly observedAtMs: number;
  readonly recordedAtMs: number;
  readonly valuationStatus: PortfolioValuationStatus;
  /** Complete account equity only; null for partial, unavailable, and legacy rows. */
  readonly equityUsd: UsdAmount | null;
  /** Display-only value of the subset priced during this observation. */
  readonly pricedSubtotalUsd: UsdAmount;
  readonly openCostUsd: UsdAmount;
  readonly realizedPnlUsd: DecimalString;
  readonly unpricedInstrumentKeys: readonly InstrumentKey[];
}

export interface PortfolioEvidenceSnapshotInput {
  readonly scheduledForMs: number;
  readonly observedAtMs: number;
  readonly recordedAtMs: number;
  readonly valuationStatus: PortfolioValuationStatus;
  readonly equityUsd: string | null;
  readonly pricedSubtotalUsd: string;
  readonly openCostUsd: string;
  readonly realizedPnlUsd: string;
  readonly unpricedInstrumentKeys: readonly string[];
}

export function portfolioUtcDayKey(atMs: number): number {
  if (!Number.isSafeInteger(atMs) || atMs < 0) {
    throw new RangeError('Portfolio evidence time must be a non-negative safe integer.');
  }
  return Math.floor(atMs / DAY_MS) * DAY_MS;
}

function canonicalUnpriced(values: readonly string[]): readonly InstrumentKey[] {
  const unique = new Set<InstrumentKey>();
  for (const value of values) {
    if (!CANONICAL_INSTRUMENT.test(value)) {
      throw new TypeError('Unpriced portfolio instruments must use canonical identity keys.');
    }
    unique.add(value as InstrumentKey);
  }
  return Object.freeze([...unique].sort((left, right) => left.localeCompare(right)));
}

/** Validate, detach, and deeply freeze one portfolio valuation observation. */
export function createPortfolioEvidenceSnapshot(
  input: PortfolioEvidenceSnapshotInput,
): PortfolioEvidenceSnapshot {
  if (!['complete', 'partial', 'unavailable', 'legacy_unverified'].includes(
    input.valuationStatus,
  )) {
    throw new TypeError('Portfolio evidence valuation status is invalid.');
  }
  const dayKeyMs = portfolioUtcDayKey(input.scheduledForMs);
  portfolioUtcDayKey(input.observedAtMs);
  portfolioUtcDayKey(input.recordedAtMs);
  if (input.observedAtMs < input.scheduledForMs || input.recordedAtMs < input.observedAtMs) {
    throw new RangeError('Portfolio evidence times must follow scheduled, observed, recorded order.');
  }
  const unpricedInstrumentKeys = canonicalUnpriced(input.unpricedInstrumentKeys);
  const pricedSubtotalUsd = nonNegativeDecimal(input.pricedSubtotalUsd);
  const openCostUsd = nonNegativeDecimal(input.openCostUsd);
  const realizedPnlUsd = decimal(input.realizedPnlUsd);
  const equityUsd = input.equityUsd === null ? null : nonNegativeDecimal(input.equityUsd);
  if (input.valuationStatus === 'complete') {
    if (equityUsd === null || unpricedInstrumentKeys.length !== 0) {
      throw new TypeError('Complete portfolio evidence requires equity and no unpriced instruments.');
    }
  } else if (equityUsd !== null) {
    throw new TypeError('Incomplete portfolio evidence cannot contain complete equity.');
  }
  if (input.valuationStatus === 'partial' && unpricedInstrumentKeys.length === 0) {
    throw new TypeError('Partial portfolio evidence must identify an unpriced instrument.');
  }
  const id = `portfolio:${input.scheduledForMs}:${input.observedAtMs}`;
  return Object.freeze({
    id,
    dayKeyMs,
    scheduledForMs: input.scheduledForMs,
    observedAtMs: input.observedAtMs,
    recordedAtMs: input.recordedAtMs,
    valuationStatus: input.valuationStatus,
    equityUsd,
    pricedSubtotalUsd,
    openCostUsd,
    realizedPnlUsd,
    unpricedInstrumentKeys,
  });
}
