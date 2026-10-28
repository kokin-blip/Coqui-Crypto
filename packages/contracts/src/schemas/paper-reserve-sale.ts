import * as z from 'zod';
import { epochMillisecondsSchema as at } from '../messages.js';
import { decimalStringSchema as decimal, sha256HexSchema as hash } from './provenance.js';
import { paperReserveProposalSchema,paperProfitReserveChannelSchemas } from './paper-profit-reserve.js';
import { paperExecutionChannelSchemas } from './paper-execution.js';
const ref=z.string().min(1).max(256),refs=z.array(ref).max(100).readonly();
const money=z.string().regex(/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/u),positive=money.refine(v=>Number(v)>0);
export const paperReserveSalePreferencesSchema=z.strictObject({reserveUsd:positive,retainedFloorUsd:money,maxCostUsd:money,maxNotionalUsd:positive,
  maxExposureReductionUsd:positive,eligibleAssetIds:z.array(ref).min(1).max(10).refine(v=>new Set(v).size===v.length)}).readonly();
const objective=z.strictObject({reserveUsd:decimal,economicBackingUsd:decimal,realizedBackingUsd:decimal,freshProfitUsd:decimal,shareBps:z.number().int().min(1).max(10000),
  additionalTaxUsd:decimal,profitBackedTaxUsd:decimal,retainedFloorUsd:decimal,maxCostUsd:decimal,maxNotionalUsd:decimal,maxExposureReductionUsd:decimal,eligibleAssetIds:z.array(ref).max(10),reviewRef:ref}).readonly();
export const paperReserveSaleConsequenceSchema=z.strictObject({id:hash,version:z.literal('paper-reserve-sale-v1'),scopeId:hash,budgetRevision:hash,policyId:hash,stateId:hash,inputHash:hash,expiresAtMs:at,
  state:z.enum(['modeled','already_funded','infeasible','unavailable']),reasons:refs,selectedAssetId:ref.nullable(),objective,minimumWithinSupportedCandidates:z.boolean(),
  candidates:z.array(z.strictObject({assetId:ref,state:z.enum(['modeled','infeasible','unavailable']),reasons:refs,quantity:decimal.nullable(),notionalUsd:decimal.nullable(),costUsd:decimal.nullable(),
    realizedGainUsd:decimal.nullable(),netProceedsUsd:decimal.nullable(),residualQuantity:decimal.nullable(),feasibilityId:hash.nullable()}).readonly()).max(10),
  fundsEligibility:z.literal(false),orderSubmissionPermitted:z.literal(false),externalWithdrawalPermitted:z.literal(false)}).readonly();
const empty=z.strictObject({}),command={commandId:z.uuid()},proposal={proposalId:hash};
export const paperReserveSaleChannelSchemas={
  'paper.reserve.sale.observe':paperProfitReserveChannelSchemas['paper.reserve.observe'],
  'paper.reserve.sale.status':{request:empty,response:z.strictObject({scopeId:hash.nullable(),policyId:hash.nullable(),stateId:hash.nullable(),observedAtMs:at.nullable(),expiresAtMs:at.nullable(),armed:z.boolean(),
    reviewEvidence:z.enum(['pending','current_reference']),gateCodes:refs,assets:z.array(z.strictObject({assetId:ref,quantity:decimal})).max(10),liveExecutionPermitted:z.literal(false),externalWithdrawalPermitted:z.literal(false)}).readonly()},
  'paper.reserve.sale.preview':{request:paperReserveSalePreferencesSchema,response:z.strictObject({preferencesHash:hash,consequence:paperReserveSaleConsequenceSchema.nullable(),reasonCodes:refs,gateCodes:refs}).readonly()},
  'paper.reserve.sale.proposals':{request:empty,response:z.array(z.strictObject({proposalId:hash,proposalHash:hash,requiredExecutionBarStartMs:at.nullable(),policyId:hash,preparedAtMs:at,status:ref,consequence:paperReserveSaleConsequenceSchema}).readonly()).max(20).readonly()},
  'paper.reserve.sale.prepare':{request:z.strictObject({...command,consequenceId:hash}),response:z.strictObject({proposalId:hash,consequenceId:hash,reserveFunded:z.literal(false)}).readonly()},
  'paper.reserve.sale.order.preview':{request:z.strictObject({...command,...proposal}),response:paperExecutionChannelSchemas['paper.execution.preview'].response},
  'paper.reserve.sale.order.review':{request:z.strictObject({...command,...proposal,proposalHash:hash,decision:z.enum(['approve','reject']),previewHash:hash.nullable(),previewExpiresAtMs:at}),response:paperExecutionChannelSchemas['paper.execution.review'].response},
  'paper.reserve.sale.reconcile':{request:z.strictObject({...command,...proposal}),response:z.strictObject({status:z.enum(['settlement_unresolved','reassessed']),proposal:paperReserveProposalSchema.nullable(),reserveFunded:z.literal(false)}).readonly()},
} as const;
