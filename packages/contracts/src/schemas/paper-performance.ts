import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { decimalStringSchema, sha256HexSchema } from './provenance.js';

const nullableDecimal = decimalStringSchema.nullable();
const pointSchema = z.strictObject({
  dayUtc: epochMillisecondsSchema,
  equityUsd: decimalStringSchema,
  benchmarkUsd: nullableDecimal,
  pnlUsd: nullableDecimal,
  returnPct: nullableDecimal,
  drawdownPct: decimalStringSchema,
  evidenceHash: sha256HexSchema,
}).readonly();

const metricsSchema = z.strictObject({
  annualizedReturnPct: nullableDecimal,
  volatilityPct: nullableDecimal,
  sharpe: nullableDecimal,
  sortino: nullableDecimal,
  calmar: nullableDecimal,
  maxDrawdownPct: decimalStringSchema,
  winRatePct: nullableDecimal,
  profitFactor: z.union([decimalStringSchema, z.literal('infinite')]).nullable(),
  turnoverPct: nullableDecimal,
  venueFeesUsd: decimalStringSchema,
  spreadUsd: decimalStringSchema,
  slippageUsd: decimalStringSchema,
  impactUsd: decimalStringSchema,
  timeBelowHighPct: decimalStringSchema,
  riskFreeRatePct: z.literal('0'),
  annualizationDays: z.literal(365),
}).readonly();

const fillFactSchema = z.strictObject({
  orderId: z.string().min(1).max(128),
  productId: z.string().min(1).max(64),
  side: z.enum(['buy', 'sell']),
  quantity: decimalStringSchema,
  executionPrice: decimalStringSchema,
  notionalUsd: decimalStringSchema,
  venueFeeUsd: decimalStringSchema,
  spreadUsd: decimalStringSchema,
  slippageUsd: decimalStringSchema,
  impactUsd: decimalStringSchema,
  filledAt: epochMillisecondsSchema,
  marketSnapshotHash: sha256HexSchema,
}).readonly();

export const paperPerformanceChannelSchemas = {
  'paper.performance': {
    request: z.strictObject({}).readonly(),
    response: z.strictObject({
      points: z.array(pointSchema).max(10_000).readonly(),
      monthlyPnl: z.array(z.strictObject({
        month: z.string().regex(/^\d{4}-\d{2}$/u),
        pnlUsd: decimalStringSchema,
      }).readonly()).max(1_200).readonly(),
      distribution: z.array(z.strictObject({
        bucket: z.string().min(1).max(40), count: z.number().int().nonnegative(),
      }).readonly()).max(20).readonly(),
      worstDrawdowns: z.array(z.strictObject({
        peakDayUtc: epochMillisecondsSchema,
        troughDayUtc: epochMillisecondsSchema,
        recoveredDayUtc: epochMillisecondsSchema.nullable(),
        drawdownPct: decimalStringSchema,
        declineDays: z.number().int().nonnegative(),
        recoveryDays: z.number().int().nonnegative().nullable(),
      }).readonly()).max(10).readonly(),
      metrics: metricsSchema,
      exclusions: z.strictObject({
        incompleteValuationDays: z.number().int().nonnegative(),
        invalidEvidenceRows: z.number().int().nonnegative(),
        missingCalendarDays: z.number().int().nonnegative(),
        unattributedOpeningBalanceExcluded: z.boolean(),
      }).readonly(),
      benchmarkStatus: z.enum(['available', 'unavailable_starting_evidence']),
    }).readonly(),
  },
  'paper.performance-day': {
    request: z.strictObject({
      dayUtc: epochMillisecondsSchema.refine((value) => value % 86_400_000 === 0),
    }).readonly(),
    response: z.strictObject({
      dayUtc: epochMillisecondsSchema,
      evidence: z.strictObject({
        capturedAt: epochMillisecondsSchema,
        cashUsd: decimalStringSchema,
        equityUsd: nullableDecimal,
        benchmarkUsd: nullableDecimal,
        unpricedCount: z.number().int().nonnegative(),
        evidenceHash: sha256HexSchema,
        provenanceJson: z.string().max(20_000),
      }).readonly().nullable(),
      fills: z.array(fillFactSchema).max(5_000).readonly(),
      transitions: z.array(z.strictObject({
        orderId: z.string().min(1).max(128),
        sequence: z.number().int().nonnegative(),
        state: z.string().min(1).max(40),
        at: epochMillisecondsSchema,
        detailJson: z.string().max(4_000),
      }).readonly()).max(20_000).readonly(),
    }).readonly(),
  },
} as const;
