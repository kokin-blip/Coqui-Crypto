import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { decimalStringSchema, sha256HexSchema } from './provenance.js';

const at = epochMillisecondsSchema;
const hash = sha256HexSchema;
const refs = z.array(z.string().min(1).max(256)).max(100_000).readonly();
const reasons = z.array(z.string().min(1).max(128)).max(100).readonly();
const nullableMoney = decimalStringSchema.nullable();
export const capitalMetricSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('available'), value: decimalStringSchema, method: z.string().min(1).max(128), evidenceRefs: refs }),
  z.strictObject({ state: z.literal('unavailable'), reasonCodes: reasons, missingEvidence: reasons,
    restoration: z.array(z.string().min(1).max(1_000)).max(100).readonly() }),
]).readonly();

export const capitalScopeSchema = z.strictObject({
  id: hash, provider: z.enum(['local_paper', 'alpaca', 'coinbase', 'robinhood']),
  environment: z.enum(['simulation', 'paper', 'production_read_only']), accountIdentityHash: hash,
  currency: z.literal('USD'), originProfileId: z.string().min(1).max(128), createdAtMs: at,
}).refine((value) => value.provider === 'local_paper' ? value.environment === 'simulation' :
  value.provider === 'alpaca' ? value.environment === 'paper' : value.environment === 'production_read_only').readonly();
export const capitalCoverageSchema = z.strictObject({
  fromMs: at.nullable(), toMs: at, complete: z.boolean(), paginationComplete: z.boolean(),
  membershipComplete: z.boolean(), reasonCodes: reasons,
}).refine((v) => v.fromMs === null || v.fromMs <= v.toMs)
  .refine((v) => !v.complete || v.fromMs !== null && v.paginationComplete && v.membershipComplete).readonly();
export const capitalSourceBatchSchema = z.strictObject({
  id: hash, scopeId: hash, source: z.string().min(1).max(128), requestedAtMs: at,
  observedAtMs: at, recordedAtMs: at, coverage: capitalCoverageSchema,
  memberIdentityHashes: z.array(hash).max(10_000).readonly(), evidenceRefs: refs, payload: z.json(),
}).refine((v) => v.requestedAtMs <= v.observedAtMs && v.observedAtMs <= v.recordedAtMs && v.coverage.toMs <= v.observedAtMs).readonly();
export const capitalLegSchema = z.strictObject({
  asset: z.string().min(1).max(256), quantity: decimalStringSchema,
  role: z.enum(['cash', 'asset', 'fee', 'receivable', 'liability']), valueUsd: nullableMoney,
  valuationRef: z.string().min(1).max(256).nullable(),
}).readonly();
export const capitalEventSchema = z.strictObject({
  id: hash, scopeId: hash, sourceBatchId: hash, logicalKey: z.string().min(1).max(512), revisionHash: hash,
  replacesId: hash.nullable(), correctionAuthority: z.enum(['status_transition', 'provider_revision', 'normalizer_correction']).nullable(),
  kind: z.enum(['contribution', 'outflow', 'internal_transfer', 'trade', 'fee', 'income', 'unknown']),
  status: z.enum(['confirmed', 'pending', 'failed', 'conflict']),
  effectiveTime: z.strictObject({ precision: z.enum(['instant', 'date', 'unknown']), fromMs: at.nullable(), toMs: at.nullable() })
    .refine((v) => v.fromMs === null || v.toMs === null || v.fromMs <= v.toMs)
    .refine((v) => v.precision !== 'instant' || v.fromMs !== null && v.fromMs === v.toMs).readonly(),
  observedAtMs: at, recordedAtMs: at, legs: z.array(capitalLegSchema).max(100).readonly(),
  externalFlowUsd: nullableMoney, flowVerified: z.boolean(), confirmedUserReceiptUsd: nullableMoney,
  feeUsd: nullableMoney, incomeUsd: nullableMoney, beforeValuationId: hash.nullable(), afterValuationId: hash.nullable(),
  evidenceRefs: refs, reasonCodes: reasons,
}).refine((v) => !v.flowVerified || v.externalFlowUsd !== null && v.status === 'confirmed')
  .refine((v) => v.externalFlowUsd === null || v.kind !== 'contribution' || !v.externalFlowUsd.startsWith('-'))
  .refine((v) => v.externalFlowUsd === null || v.kind !== 'outflow' || v.externalFlowUsd.startsWith('-') || /^0(?:\.0+)?$/u.test(v.externalFlowUsd))
  .refine((v) => !v.flowVerified || ['contribution', 'outflow'].includes(v.kind) || /^0(?:\.0+)?$/u.test(v.externalFlowUsd!))
  .refine((v) => [v.feeUsd, v.incomeUsd, v.confirmedUserReceiptUsd].every((amount) => amount === null || !amount.startsWith('-'))).readonly();
export const capitalValuationSchema = z.strictObject({
  id: hash, scopeId: hash, sourceBatchId: hash, replacesId: hash.nullable(), atMs: at, sequence: z.number().int().nonnegative(),
  observedAtMs: at, equityUsd: nullableMoney, cashUsd: nullableMoney,
  legs: z.array(capitalLegSchema).max(10_000).readonly(), verified: z.boolean(), missingComponents: reasons, evidenceRefs: refs,
}).refine((v) => !v.verified || v.equityUsd !== null && v.missingComponents.length === 0).readonly();
export const capitalEpochSchema = z.strictObject({
  id: hash, scopeId: hash, openingValuationId: hash, predecessorId: hash.nullable(),
  reason: z.enum(['verified_origin', 'forward_tracking', 'capital_restarted']), historicalLimitations: reasons,
}).readonly();

export const capitalPerformanceReportSchema = z.strictObject({
  schemaVersion: z.literal(1), calculationVersion: z.literal('capital-flow-performance-v1'), inputHash: hash,
  scopeId: hash, epochId: hash.nullable(), fromMs: at.nullable(), toMs: at.nullable(),
  inputManifest: z.strictObject({ batchIds: z.array(hash).max(100_000).readonly(),
    eventIds: z.array(hash).max(100_000).readonly(), valuationIds: z.array(hash).max(100_000).readonly() }).readonly(),
  points: z.array(z.strictObject({ valuationId: hash, atMs: at, equityUsd: nullableMoney,
    unitNavUsd: nullableMoney, returnPct: nullableMoney, drawdownPct: nullableMoney }).readonly()).max(100_000).readonly(),
  metrics: z.strictObject({
    equityUsd: capitalMetricSchema, balanceChangeUsd: capitalMetricSchema, economicPnlUsd: capitalMetricSchema,
    contributionsUsd: capitalMetricSchema, netOutflowsUsd: capitalMetricSchema, confirmedUserReceiptsUsd: capitalMetricSchema,
    feesUsd: capitalMetricSchema, incomeUsd: capitalMetricSchema, timeWeightedReturnPct: capitalMetricSchema,
    annualizedReturnPct: capitalMetricSchema, moneyWeightedReturnPct: capitalMetricSchema,
    maxDrawdownPct: capitalMetricSchema, volatilityPct: capitalMetricSchema, sharpe: capitalMetricSchema,
    sortino: capitalMetricSchema, calmar: capitalMetricSchema, timeBelowHighPct: capitalMetricSchema,
    realizedPnlUsd: capitalMetricSchema, unrealizedPnlUsd: capitalMetricSchema,
  }).readonly(), reasonCodes: reasons, historicalLimitations: reasons,
  annualizationDays: z.literal(365), riskFreeRatePct: z.literal('0'),
}).readonly();

export const capitalPerformanceChannelSchemas = {
  'capital.scopes': {
    request: z.strictObject({}).readonly(),
    response: z.strictObject({ schemaVersion: z.literal(1), scopes: z.array(z.strictObject({
      scope: capitalScopeSchema, mode: z.enum(['active', 'archived', 'disconnected']),
      label: z.string().min(1).max(256),
      connectionId: z.string().min(1).max(128).nullable(), epochs: z.array(capitalEpochSchema).max(1_000).readonly(),
      latestObservedAtMs: at.nullable(), coverage: capitalCoverageSchema.nullable(),
    }).readonly()).max(1_000).readonly() }).readonly(),
  },
  'capital.performance': {
    request: z.strictObject({ scopeId: hash, epochId: hash.nullable(), fromMs: at.nullable(), toMs: at.nullable() })
      .refine((v) => v.fromMs === null || v.toMs === null || v.fromMs <= v.toMs).readonly(),
    response: capitalPerformanceReportSchema,
  },
} as const;
