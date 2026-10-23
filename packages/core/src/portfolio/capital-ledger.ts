import { Decimal } from 'decimal.js';

import { canonicalJson, type CanonicalJsonValue } from '../evidence/decision.js';
import { sha256Hex } from '../crypto/sha256.js';
import { decimal } from '../types/money.js';

export const CAPITAL_CALCULATION_VERSION = 'capital-flow-performance-v1' as const;
export type CapitalProvider = 'local_paper' | 'alpaca' | 'coinbase' | 'robinhood';
export type CapitalEnvironment = 'simulation' | 'paper' | 'production_read_only';

export interface CapitalScope {
  readonly id: string;
  readonly provider: CapitalProvider;
  readonly environment: CapitalEnvironment;
  readonly accountIdentityHash: string;
  readonly currency: 'USD';
  readonly originProfileId: string;
  readonly createdAtMs: number;
}

export interface CapitalCoverage {
  readonly fromMs: number | null;
  readonly toMs: number;
  readonly complete: boolean;
  readonly paginationComplete: boolean;
  readonly membershipComplete: boolean;
  readonly reasonCodes: readonly string[];
}

export interface CapitalSourceBatch {
  readonly id: string;
  readonly scopeId: string;
  readonly source: string;
  readonly requestedAtMs: number;
  readonly observedAtMs: number;
  readonly recordedAtMs: number;
  readonly coverage: CapitalCoverage;
  readonly memberIdentityHashes: readonly string[];
  readonly evidenceRefs: readonly string[];
  /** Sanitized financial facts only; never credentials, headers or personal descriptions. */
  readonly payload: CanonicalJsonValue;
}

export interface CapitalLeg {
  readonly asset: string;
  readonly quantity: string;
  readonly role: 'cash' | 'asset' | 'fee' | 'receivable' | 'liability';
  readonly valueUsd: string | null;
  readonly valuationRef: string | null;
}

export interface CapitalEventRevision {
  readonly id: string;
  readonly scopeId: string;
  readonly sourceBatchId: string;
  readonly logicalKey: string;
  readonly revisionHash: string;
  readonly replacesId: string | null;
  readonly correctionAuthority: 'status_transition' | 'provider_revision' | 'normalizer_correction' | null;
  readonly kind: 'contribution' | 'outflow' | 'internal_transfer' | 'trade' | 'fee' | 'income' | 'unknown';
  readonly status: 'confirmed' | 'pending' | 'failed' | 'conflict';
  readonly effectiveTime: {
    readonly precision: 'instant' | 'date' | 'unknown';
    readonly fromMs: number | null;
    readonly toMs: number | null;
  };
  readonly observedAtMs: number;
  readonly recordedAtMs: number;
  readonly legs: readonly CapitalLeg[];
  /** Positive contribution, negative confirmed net outflow, zero proven internal activity. */
  readonly externalFlowUsd: string | null;
  readonly flowVerified: boolean;
  readonly confirmedUserReceiptUsd: string | null;
  readonly feeUsd: string | null;
  readonly incomeUsd: string | null;
  readonly beforeValuationId: string | null;
  readonly afterValuationId: string | null;
  readonly evidenceRefs: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface CapitalValuation {
  readonly id: string;
  readonly scopeId: string;
  readonly sourceBatchId: string;
  readonly replacesId: string | null;
  readonly atMs: number;
  /** Orders genuinely simultaneous before/after flow observations; never invented from row order. */
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly equityUsd: string | null;
  readonly cashUsd: string | null;
  readonly legs: readonly CapitalLeg[];
  readonly verified: boolean;
  readonly missingComponents: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface CapitalTrackingEpoch {
  readonly id: string;
  readonly scopeId: string;
  readonly openingValuationId: string;
  readonly predecessorId: string | null;
  readonly reason: 'verified_origin' | 'forward_tracking' | 'capital_restarted';
  readonly historicalLimitations: readonly string[];
}

export type CapitalMetric = {
  readonly state: 'available';
  readonly value: string;
  readonly method: string;
  readonly evidenceRefs: readonly string[];
} | {
  readonly state: 'unavailable';
  readonly reasonCodes: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly restoration: readonly string[];
};

export const CAPITAL_RESTORATION: Readonly<Record<string, string>> = Object.freeze({
  opening_missing: 'Acquire a complete economic opening valuation for this account; earlier history cannot be inferred.',
  valuation_missing: 'Acquire a complete account valuation at the requested boundary, with its actual valuation time.',
  history_incomplete: 'Acquire and reconcile complete account activity for the displayed period, including pagination and membership.',
  flow_unverified: 'Obtain evidence of the capital boundary, actual amount, status and financial effective interval.',
  flow_boundary_ambiguous: 'Obtain financial effective-time evidence proving which side of the period boundary contains this event.',
  flow_time_marks_missing: 'Obtain actual before/after valuations and ordering at each external flow; estimates are excluded.',
  flow_time_unverified: 'Obtain the actual financial effective time of each dated cash flow; observation and creation times are not substitutes.',
  flow_boundary_not_reconciled: 'Reconcile the flow and its before/after valuations, including separate fee effects.',
  conflicting_revision: 'Obtain an authoritative correction or reversal linking the conflicting provider facts.',
  daily_series_incomplete: 'Collect a complete series at a consistent daily valuation time; missing historical marks are not backfilled.',
  insufficient_observations: 'Collect sufficient complete observations for this descriptive statistic.',
  less_than_one_year: 'Collect at least 365 elapsed days of supported return evidence before annualizing TWR.',
  zero_denominator: 'Inspect the zero-capital or zero-NAV segment; select a supported segment rather than erasing prior losses.',
  irr_uniqueness_unproven: 'A unique IRR is not certified for this cash-flow pattern; no approximate root is reported.',
  irr_no_solution: 'No supported finite IRR solution exists for these cash flows.',
  irr_numerical_failure: 'Inspect the dated cash-flow evidence and supported numerical domain.',
  attribution_incomplete: 'Obtain separately attributable posted costs, income or confirmed receipt evidence.',
  unscoped_cost_basis: 'Supply reconciled cost-basis evidence tied to this financial account; economic opening value is not tax basis.',
  account_identity_unverified: 'Verify the financial account and environment before interpreting account performance.',
  archived_scope: 'This is archived evidence. Verify the account again before collecting fresh coverage.',
});

export function capitalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value as CanonicalJsonValue));
}

export function capitalDecimal(value: string): string {
  decimal(value);
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.precision() > 80) throw new TypeError('Invalid capital amount.');
  return parsed.isZero() ? '0' : parsed.toFixed();
}

export function capitalScopeId(provider: CapitalProvider, environment: CapitalEnvironment, accountIdentityHash: string): string {
  if (!/^[a-f0-9]{64}$/u.test(accountIdentityHash)) throw new TypeError('Verified capital identity hash required.');
  return capitalHash({ provider, environment, accountIdentityHash, currency: 'USD' });
}

/** Acquisition metadata cannot turn a repeated provider fact into another economic event. */
export function capitalEventIdentity(event: Omit<CapitalEventRevision, 'id' | 'revisionHash'>): { id: string; revisionHash: string } {
  const financial = {
    scopeId: event.scopeId, logicalKey: event.logicalKey, kind: event.kind, status: event.status,
    effectiveTime: event.effectiveTime, legs: event.legs, externalFlowUsd: event.externalFlowUsd,
    flowVerified: event.flowVerified, confirmedUserReceiptUsd: event.confirmedUserReceiptUsd,
    feeUsd: event.feeUsd, incomeUsd: event.incomeUsd, beforeValuationId: event.beforeValuationId,
    afterValuationId: event.afterValuationId, reasonCodes: event.reasonCodes,
  };
  const revisionHash = capitalHash(financial);
  return { id: capitalHash({ scopeId: event.scopeId, logicalKey: event.logicalKey, revisionHash }), revisionHash };
}

/** Revisions are selected through explicit lineage, never receipt order. */
export function capitalEventHeads(events: readonly CapitalEventRevision[]): {
  readonly events: readonly CapitalEventRevision[]; readonly conflicts: readonly string[];
} {
  const groups = new Map<string, CapitalEventRevision[]>();
  for (const event of events) {
    const key = `${event.scopeId}:${event.logicalKey}`;
    const prior = groups.get(key) ?? [];
    if (!prior.some((row) => row.id === event.id)) prior.push(event);
    groups.set(key, prior);
  }
  const heads: CapitalEventRevision[] = [], conflicts: string[] = [];
  for (const [key, rows] of groups) {
    const replaced = new Set(rows.map((row) => row.replacesId).filter((id) => id !== null));
    const current = rows.filter((row) => !replaced.has(row.id));
    if (current.length !== 1 || current.some((row) => row.status === 'conflict')) conflicts.push(key);
    heads.push(...current);
  }
  return { events: heads.sort((a, b) => a.id.localeCompare(b.id)), conflicts };
}
