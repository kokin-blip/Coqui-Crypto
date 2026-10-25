import * as z from 'zod';
import { epochMillisecondsSchema as at } from '../messages.js';
import { sha256HexSchema as hash, decimalStringSchema as decimal } from './provenance.js';
import { budgetReportSchema } from './capital-feasibility.js';
import { capitalMetricSchema } from './capital-performance.js';
import { reserveSettingsSchema, reserveFinancialSchema, reserveCapitalWitnessSchema } from './profit-reserve.js';
const ref = z.string().min(1).max(256), money = decimal.refine(v => !v.startsWith('-'));
const cents = money.refine(v => !v.includes('.') || v.split('.')[1]!.length <= 2);
const refs = z.array(ref).max(100_000).readonly();
export const paperReserveStrategySchema = z.strictObject({ strategyId: ref, codeRevision: ref, costProfileHash: hash, horizonMs: at.refine(v => v > 0), normalization: z.literal('gross_pct_per_turnover') }).readonly();
export const paperCapitalBookSchema = z.strictObject({ id: hash, version: z.literal('paper-reserve-cash-v1'), bookId: z.uuid(), originProfileId: ref,
  environment: z.literal('simulation'), currency: z.literal('USD'), source: z.literal('explicit_simulated_funding'), openingUsd: cents.refine(v => Number(v) > 0),
  atMs: at, fundingOperationId: z.uuid(), fundingRequestHash: hash }).readonly();
export const paperReservePolicySchema = z.strictObject({ id: hash, version: z.literal('paper-reserve-cash-v1'), scopeId: hash, originProfileId: ref,
  previousId: hash.nullable(), createdAtMs: at, settings: reserveSettingsSchema, strategy: paperReserveStrategySchema, requirementsId: hash, reviewMode: z.literal('every_mutation') }).readonly();
export const paperReserveStateSchema = z.strictObject({ id: hash, domain: z.literal('paper-reserve-cash-v1'), scopeId: hash, streamId: hash, policyId: hash, previousId: hash.nullable(),
  operationKey: ref, atMs: at, event: z.enum(['baseline','assessment','release']), hUsd: money, excludedProfitUsd: money, baseUsd: decimal, baseProfitUsd: decimal,
  cycle: z.strictObject({ id: hash, ceilingUsd: cents }).readonly().nullable(), balanceConsumed: z.boolean(),
  allocatedUsd: cents, reservedUsd: cents, taxHoldUsd: cents, profitBackedTaxUsd: cents, pendingUsd: cents, evidenceRefs: refs }).readonly();
export const paperReserveProposalSchema = z.strictObject({ id: hash, version: z.literal('paper-reserve-cash-v1'), scopeId: hash, policyId: hash, stateId: hash, requirementsId: hash,
  evaluatedAtMs: at, expiresAtMs: at, state: z.enum(['eligible','deferred','unavailable','disabled']), reasonCodes: refs, financial: reserveFinancialSchema,
  operatingRequirement: reserveCapitalWitnessSchema, triggerReached: z.boolean(), wouldRequestReview: z.boolean(), cycleCeilingUsd: cents.nullable(),
  reserveUsd: capitalMetricSchema, assessedProfitUsd: capitalMetricSchema, retainedActiveUsd: capitalMetricSchema,
  additionalTaxUsd: cents, roundingResidualUsd: capitalMetricSchema,
  caps: z.strictObject({ economicUsd: capitalMetricSchema, realizedUsd: capitalMetricSchema, cashUsd: capitalMetricSchema, capitalUsd: capitalMetricSchema }).readonly(),
  inputHash: hash, liveExecutionPermitted: z.literal(false), externalWithdrawalPermitted: z.literal(false) }).readonly();

const binding=z.strictObject({profile_id:ref,book_id:hash,scope_id:hash,policy_id:hash.nullable(),state_id:hash.nullable(),requirements_id:hash.nullable(),generation:at,archived:z.number().int().min(0).max(1),disabled:z.number().int().min(0).max(1)});
export const paperReserveViewSchema=z.strictObject({book:paperCapitalBookSchema,binding,policy:paperReservePolicySchema.nullable(),state:paperReserveStateSchema.nullable(),armed:z.boolean(),authorityHash:hash,activeSleeve:z.strictObject({version:z.literal('paper-reserve-active-sleeve-v1'),scope:z.literal('active_sleeve_only'),timeWeightedReturnPct:capitalMetricSchema,economicPnlUsd:capitalMetricSchema,inputHash:hash.nullable(),allocationStateIds:z.array(hash).max(10000),points:z.array(z.strictObject({atMs:at,unitNavUsd:decimal.nullable(),returnPct:decimal.nullable()})).max(100000)}),financial:reserveFinancialSchema,budget:budgetReportSchema.nullable(),optionalSale:z.literal('pending_review'),connected:z.literal('pending_ownership_and_evidence'),liveExecutionPermitted:z.literal(false),externalWithdrawalPermitted:z.literal(false)}).readonly();
const command={commandId:z.uuid(),bookId:hash,scopeId:hash,generation:at,policyId:hash.nullable(),stateId:hash.nullable(),budgetRevision:hash,authorityHash:hash};
const empty=z.strictObject({});
export const paperProfitReserveChannelSchemas={
  'paper.reserve.books':{request:empty,response:z.array(z.strictObject({book:paperCapitalBookSchema,archived:z.boolean(),disabled:z.boolean()})).max(1).readonly()},
  'paper.reserve.view':{request:empty,response:paperReserveViewSchema},
  'paper.reserve.preview':{request:empty,response:paperReserveProposalSchema},
  'paper.reserve.operations':{request:empty,response:z.array(z.strictObject({id:hash,scopeId:hash,operationKey:ref,kind:ref,atMs:at,refs})).max(100).readonly()},
  'paper.reserve.book.create':{request:z.strictObject({commandId:z.uuid(),bookId:z.uuid(),openingUsd:z.string().regex(/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/u).refine(v=>Number(v)>0)}),response:paperCapitalBookSchema},
  'paper.reserve.policy.save':{request:z.strictObject({...command,settings:reserveSettingsSchema}),response:paperReserveViewSchema},
  'paper.reserve.observe':{request:z.strictObject(command),response:paperReserveViewSchema},
  'paper.reserve.authorize':{request:z.strictObject(command),response:paperReserveViewSchema},
  'paper.reserve.pause':{request:z.strictObject(command),response:paperReserveViewSchema},
  'paper.reserve.resume':{request:z.strictObject(command),response:paperReserveViewSchema},
  'paper.reserve.review':{request:z.strictObject({...command,proposalId:hash}),response:paperReserveViewSchema},
  'paper.reserve.release':{request:z.strictObject({...command,proposalId:hash,purpose:z.enum(['profit_reserve','tax_hold']),amountUsd:z.string().regex(/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/u).refine(v=>Number(v)>0)}),response:paperReserveViewSchema},
} as const;
