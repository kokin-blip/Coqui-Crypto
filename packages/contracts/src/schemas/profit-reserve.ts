import * as z from 'zod';
import { epochMillisecondsSchema as at } from '../messages.js';
import { decimalStringSchema as decimal, sha256HexSchema as hash } from './provenance.js';
import { capitalMetricSchema as metric } from './capital-performance.js';

const ref = z.string().min(1).max(256), refs = z.array(ref).max(100_000).readonly(), reasons = z.array(ref).max(100).readonly();
const nonnegative = decimal.refine(v => !v.startsWith('-'));
const cents = nonnegative.refine(v => !v.includes('.') || v.split('.')[1]!.length <= 2);
const inputMoney = z.string().regex(/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/u);
const signedInput = z.string().regex(/^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/u);
export const reserveSettingsSchema = z.strictObject({
  goal: z.enum(['keep_invested', 'preview']), trigger: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('profit_usd'), value: inputMoney.refine(v => Number(v) > 0) }),
    z.strictObject({ kind: z.literal('balance_usd'), value: inputMoney.refine(v => Number(v) > 0) }),
    z.strictObject({ kind: z.literal('growth_bps'), value: z.string().regex(/^[1-9][0-9]{0,5}$/u).refine(v => Number(v) <= 100_000) }),
  ]).readonly(), shareBps: z.number().int().min(0).max(10_000), retainedCapitalUsd: inputMoney,
  minimumBatchUsd: inputMoney.refine(v => Number(v) >= 0.01), cadence: z.enum(['manual', 'daily', 'weekly', 'monthly']),
  reviewWinCount: z.number().int().min(1).max(10_000).nullable(), taxHold: z.strictObject({ amountUsd: inputMoney, backing: z.enum(['principal', 'profit', 'unknown']) }).readonly(),
}).readonly();
export const reservePolicySchema = z.strictObject({ id: hash, version: z.literal('profit-reserve-policy-v1'), scopeId: hash, originProfileId: ref,
  previousId: hash.nullable(), createdAtMs: at, settings: reserveSettingsSchema }).readonly();
export const reserveStateSchema = z.strictObject({ id: hash, domain: z.literal('preview'), scopeId: hash, streamId: hash, policyId: hash,
  previousId: hash.nullable(), operationKey: ref, atMs: at, event: z.enum(['baseline', 'cycle_open', 'assessment', 'release', 'cancel', 'closure']),
  baseline: z.enum(['ready', 'awaiting_evidence']), hUsd: nonnegative, excludedProfitUsd: nonnegative, baseUsd: decimal.nullable(), baseProfitUsd: decimal.nullable(),
  cycle: z.strictObject({ id: hash, ceilingUsd: cents }).nullable().readonly(), balanceConsumed: z.boolean(),
  allocatedUsd: cents, reservedUsd: cents, taxHoldUsd: cents, profitBackedTaxUsd: cents, pendingUsd: cents, evidenceRefs: refs,
}).readonly();
export const reserveFinancialSchema = z.strictObject({ scopeId: hash, epochId: hash.nullable(), fromMs: at.nullable(), toMs: at.nullable(),
  assurance: z.enum(['observed', 'scenario']), observedAtMs: at.nullable(), expiresAtMs: at,
  openingEquityUsd: metric, sourceCutHash: hash.nullable(), trackingLimitations: refs,
  observedCashUsd: metric, riskAssetValueUsd: metric, economicPnlUsd: metric, realizedPnlUsd: metric, unrealizedPnlUsd: metric, equityUsd: metric, activeEquityUsd: metric, spendableUsd: metric,
  contributionsUsd: metric, netOutflowsUsd: metric, confirmedReceiptsUsd: metric, incomeUsd: metric, feesUsd: metric, completedWins: metric,
  actualReservedUsd: metric, actualTaxHoldUsd: metric, actualPendingUsd: metric, priorProfitBackedUsd: metric,
  reasonCodes: reasons, evidenceRefs: refs, budgetRevision: hash.nullable(), generation: at.nullable(),
}).readonly();
export const reserveCapitalWitnessSchema = z.strictObject({ version: z.literal('reserve-capital-witness-v1'), scopeId: hash, budgetRevision: hash.nullable(),
  objective: z.enum(['fixed_request', 'cash_only', 'unbound']), floorUsd: metric, inputHash: hash.nullable(), fullReportHash: hash.nullable(), expiresAtMs: at,
  constraints: z.array(z.strictObject({ reason: ref, minimumUsd: decimal }).readonly()).max(1000).readonly(),
}).readonly();
export const reservePreviewSchema = z.strictObject({ id: hash, version: z.literal('profit-reserve-preview-v1'), mode: z.literal('preview_only'), scopeId: hash,
  policyId: hash, stateId: hash, evaluatedAtMs: at, expiresAtMs: at, assurance: z.enum(['observed', 'scenario']), executionEligible: z.literal(false), liveExecutionPermitted: z.literal(false),
  state: z.enum(['eligible', 'deferred', 'unavailable', 'disabled']), reasonCodes: reasons, financial: reserveFinancialSchema,
  modeledHUsd: nonnegative, excludedProfitUsd: nonnegative, baseUsd: decimal.nullable(), cycleCeilingUsd: decimal.nullable(), freshProfitUsd: metric,
  triggerReached: z.boolean(), wouldRequestReview: z.boolean(), triggerAmountUsd: metric,
  caps: z.strictObject({ economicUsd: metric, realizedUsd: metric, cashUsd: metric, capitalUsd: metric }).readonly(), reserveUsd: metric, assessedProfitUsd: metric,
  retainedActiveUsd: metric, roundingResidualUsd: metric, cashShortfallUsd: metric, operatingRequirement: reserveCapitalWitnessSchema,
  inputHash: hash, inputsJson: z.string().max(2_000_000), evidenceRefs: refs,
}).readonly();
export const reserveEligibilitySchema = z.strictObject({ id: hash, version: z.literal('profit-reserve-eligibility-v1'), scopeId: hash,
  fromMs: at, toMs: at, assurance: z.enum(['observed', 'scenario']), realizedPnlUsd: metric, unrealizedPnlUsd: metric, completedWins: metric,
  reasonCodes: reasons, inputHash: hash, evidenceRefs: refs, basisMethod: z.literal('scope-fifo-investment-v1'),
}).readonly();
export const reserveAssessmentSchema = z.strictObject({ id: hash, domain: z.literal('preview'), scopeId: hash, streamId: hash, operationKey: ref,
  policyId: hash, beforeId: hash, afterId: hash, previewId: hash, hBeforeUsd: nonnegative, hAfterUsd: nonnegative, assessedProfitUsd: cents,
  reserveUsd: cents, shareBps: z.number().int().min(1).max(10_000), roundingResidualUsd: nonnegative, budgetRevision: hash.nullable(), inputHash: hash,
}).readonly();
const saleSchema = z.strictObject({ status: z.enum(['not_needed', 'hypothetical', 'unavailable']), requiredCashUsd: metric, saleNotionalUsd: metric,
  modeledCostUsd: metric, realizedGainUsd: metric, residualPositionUsd: metric, accountCashAfterSaleUsd: metric, turnoverUsd: metric,
  reasonCodes: reasons, evidenceRefs: refs, fundsEligibility: z.literal(false) }).readonly();
const comparison = z.array(z.strictObject({ marketMoveBps: z.number().int(), investedOutcomeUsd: metric, reserveOutcomeUsd: metric,
  userNetInvestedUsd: metric, userNetReserveUsd: metric }).readonly()).max(5).readonly();
export const reserveInspectionSchema = z.strictObject({ id: hash, report: reservePreviewSchema, sale: saleSchema, comparison,
  comparisonAssumptions: refs, eligibility: reserveEligibilitySchema.nullable(), nextReviewAtMs: at.nullable(),
}).readonly();
const observed = z.strictObject({ mode: z.literal('observed'), scopeId: hash, settings: reserveSettingsSchema.optional() });
const scenario = z.strictObject({ mode: z.literal('scenario'), openingUsd: inputMoney.refine(v => Number(v) > 0), profitUsd: signedInput,
  realizedProfitUsd: signedInput, cashUsd: inputMoney, externalExpenseUsd: inputMoney, settings: reserveSettingsSchema });
const command = { commandId: z.uuid(), scopeId: hash, expectedPolicyId: hash.nullable(), expectedStateId: hash.nullable(), expectedInputHash: hash };
export const reserveViewSchema = z.strictObject({ schemaVersion: z.literal(1), mode: z.literal('preview_only'), scopeId: hash,
  policy: reservePolicySchema.nullable(), state: reserveStateSchema.nullable(), archived: z.boolean(), financial: reserveFinancialSchema,
  latest: reserveInspectionSchema.nullable(), historicalPreviewIds: z.array(hash).max(100).readonly(),
  executionEligible: z.literal(false), liveExecutionPermitted: z.literal(false),
}).readonly();
export const profitReserveChannelSchemas = {
  'capital.reserve.view': { request: z.strictObject({ scopeId: hash }), response: reserveViewSchema },
  'capital.reserve.preview': { request: z.discriminatedUnion('mode', [observed, scenario]), response: reserveInspectionSchema },
  'capital.reserve.settings.save': { request: z.strictObject({ ...command, settings: reserveSettingsSchema }), response: reserveViewSchema },
  'capital.reserve.inspect': { request: z.strictObject(command), response: reserveInspectionSchema },
} as const;
