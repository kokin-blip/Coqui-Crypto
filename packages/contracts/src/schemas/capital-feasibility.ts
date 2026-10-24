import * as z from 'zod';
import { epochMillisecondsSchema as at } from '../messages.js';
import { decimalStringSchema as decimal } from './provenance.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/u), ref = z.string().min(1).max(256);
const refs = z.array(ref).max(10_000).readonly(), reasons = z.array(ref).max(100).readonly();
const nonnegative = decimal.refine(value => !value.startsWith('-')), amounts = z.record(ref, nonnegative).readonly();
export const nativeRuleValueSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('known'), value: nonnegative }),
  z.strictObject({ state: z.literal('not_applicable'), evidenceRef: ref }),
  z.strictObject({ state: z.literal('unknown'), reason: ref }),
]).readonly();
export const nativeExecutionRulesSchema = z.strictObject({
  id: hash, version: z.literal('native-execution-rules-v1'), provider: z.enum(['coinbase', 'alpaca']),
  environment: z.enum(['production_read_only', 'paper']), assetId: ref, productId: ref, baseCurrency: ref, quoteCurrency: z.literal('USD'),
  form: z.literal('market_quantity'), timeInForce: z.enum(['gtc', 'ioc']), tradable: z.boolean().nullable(), assurance: z.enum(['observed', 'scenario']),
  quantityIncrement: nativeRuleValueSchema, quantityMin: nativeRuleValueSchema, quantityMax: nativeRuleValueSchema,
  quoteIncrement: nativeRuleValueSchema, quoteMin: nativeRuleValueSchema, quoteMax: nativeRuleValueSchema, priceIncrement: nativeRuleValueSchema,
  observedAtMs: at, expiresAtMs: at, source: ref, evidenceRefs: refs, rawEvidenceJson: z.string().max(20_000),
}).refine(row => row.expiresAtMs > row.observedAtMs && row.expiresAtMs <= row.observedAtMs + 30_000 &&
  (row.provider === 'coinbase' ? row.environment === 'production_read_only' : row.environment === 'paper')).readonly();
export const cashClaimSchema = z.strictObject({
  id: hash, scopeId: hash, originKey: ref, replacesId: hash.nullable(), assetId: ref, amount: nonnegative,
  purpose: z.enum(['order', 'fee_contingency', 'operational_buffer', 'profit_reserve', 'tax_hold']),
  state: z.enum(['committed', 'unknown', 'settled', 'released']),
  reflectedIn: z.array(z.enum(['cash', 'venue', 'position'])).max(3).readonly(), reflectionEvidence: refs, evidenceRefs: refs,
}).refine(row => row.reflectedIn.length === new Set(row.reflectedIn).size && (row.reflectedIn.length === 0 || row.reflectionEvidence.length > 0)).readonly();
export const feasibilityFeesSchema = z.strictObject({ id: hash, rate: nonnegative, currency: z.enum(['USD', 'received']), fixedUsd: nonnegative,
  slippageBps: nonnegative, assurance: z.enum(['observed', 'scenario']), expiresAtMs: at }).readonly();
export const accountBudgetEvidenceSchema = z.strictObject({
  id: hash, scopeId: hash, bookId: ref, provider: z.enum(['local_paper', 'coinbase', 'alpaca', 'robinhood']),
  environment: z.enum(['simulation', 'paper', 'production_read_only']), observedAtMs: at, expiresAtMs: at,
  cashUsd: decimal.nullable(), equityUsd: decimal.nullable(), venueEligibleUsd: nativeRuleValueSchema, positions: amounts, marks: amounts,
  quotes: z.record(ref, z.strictObject({ bid: nonnegative, ask: nonnegative, atMs: at }).readonly()).readonly(),
  ruleIds: z.array(hash).max(100).readonly(), fees: feasibilityFeesSchema.nullable(),
  complete: z.boolean(), holdMatchingComplete: z.boolean(), authority: z.enum(['isolated_book', 'unproven', 'legacy_writer']),
  assurance: z.enum(['observed', 'scenario']), reasonCodes: reasons, evidenceRefs: refs,
}).refine(row => row.expiresAtMs > row.observedAtMs && row.expiresAtMs <= row.observedAtMs + 30_000 &&
  (row.provider === 'local_paper' ? row.environment === 'simulation' : row.provider === 'alpaca' ? row.environment === 'paper' : row.environment === 'production_read_only') &&
  (row.authority !== 'isolated_book' || row.provider === 'local_paper')).readonly();
export const budgetReportSchema = z.strictObject({
  id: hash, version: z.literal('account-budget-v1'), scopeId: hash, bookId: ref, sourceId: hash, revision: hash,
  evaluatedAtMs: at, observedAtMs: at, expiresAtMs: at, assurance: z.enum(['observed', 'scenario']), state: z.enum(['available', 'unavailable']),
  observedCashUsd: decimal.nullable(), equityUsd: decimal.nullable(), activeEquityUsd: decimal.nullable(), spendableUsd: nonnegative.nullable(),
  positions: amounts, quantities: amounts, deficits: amounts,
  deductions: z.array(z.strictObject({ claimId: hash, cashUsd: nonnegative, venueUsd: nonnegative }).readonly()).max(10_000).readonly(),
  claimIds: z.array(hash).max(10_000).readonly(), reasonCodes: reasons, restoration: reasons, executionEligible: z.boolean(),
}).refine(row => row.state === 'available' ? row.spendableUsd !== null && row.reasonCodes.length === 0 : row.spendableUsd === null).readonly();
export const feasibilityPolicySchema = z.strictObject({
  id: hash, maxOrders: z.number().int().min(0).max(100), maxOrderUsd: nonnegative, maxTurnoverUsd: nonnegative, usedTurnoverUsd: nonnegative,
  maxEntryFraction: nonnegative, maxPositionFraction: nonnegative, accountMaxPositionFraction: nonnegative,
  maxInvestedFraction: nonnegative, accountMaxInvestedFraction: nonnegative, discretionaryFloorUsd: nonnegative,
  riskExitBypassesDiscretionaryFloor: z.boolean(), killSwitchEngaged: z.boolean(),
}).readonly();
export const capitalFeasibilityReportSchema = z.strictObject({
  id: hash, version: z.literal('capital-feasibility-v1'), scopeId: hash, budgetRevision: hash, evaluatedAtMs: at, expiresAtMs: at,
  assurance: z.enum(['observed', 'scenario']), state: z.enum(['feasible', 'infeasible', 'unavailable']), executionEligible: z.literal(false),
  orders: z.array(z.strictObject({ assetId: ref, side: z.enum(['buy', 'sell']), requestedQuantity: nonnegative, quantity: nonnegative,
    deliveredQuantity: nonnegative, executionPriceUsd: nonnegative, notionalUsd: nonnegative, cashDebitUsd: nonnegative,
    cashCreditUsd: nonnegative, feeUsd: nonnegative, residualQuantity: nonnegative, strategyRefs: refs, rulesId: hash }).readonly()).max(100).readonly(),
  blocked: z.array(z.strictObject({ assetId: ref, reasons }).readonly()).max(100).readonly(), reasonCodes: reasons,
  remainingBuyCashUsd: decimal.nullable(), projectedCashUsd: decimal.nullable(), projectedEquityUsd: decimal.nullable(),
  oneWayTurnoverUsd: nonnegative.nullable(), totalFeeUsd: nonnegative.nullable(), quantities: amounts, riskResiduals: reasons,
  operatingFloor: z.strictObject({ state: z.literal('unavailable'), reason: z.literal('no_global_floor_certificate') }).readonly(),
  inputsJson: z.string().max(1_000_000),
  inputManifest: z.strictObject({ budgetId: hash, ruleIds: z.array(hash).max(100).readonly(), feeId: hash, policyId: hash, inputHash: hash,
    proposal: z.strictObject({ id: ref, hash, revision: at }).nullable().readonly() }).readonly(),
}).readonly();
export const capitalFeasibilityRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('proposal'), scopeId: hash, expectedRevision: hash, proposalId: ref }),
  z.strictObject({ mode: z.literal('scenario'), scopeId: hash.nullable(), capitalUsd: nonnegative, tradeUsd: nonnegative,
    minimumQuantity: nonnegative, quantityIncrement: nonnegative }),
]).readonly();
export const capitalFeasibilityChannelSchemas = {
  'capital.budget': { request: z.strictObject({ scopeId: hash }).readonly(), response: z.strictObject({ schemaVersion: z.literal(1),
    budget: budgetReportSchema.nullable(), nativeRules: z.array(nativeExecutionRulesSchema).max(100).readonly(), reasonCodes: reasons }).readonly() },
  'capital.feasibility': { request: capitalFeasibilityRequestSchema, response: capitalFeasibilityReportSchema },
} as const;
