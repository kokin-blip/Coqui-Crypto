import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { decimalStringSchema, sha256HexSchema } from './provenance.js';

const emptyPayloadSchema = z.strictObject({}).readonly();
const commandIdSchema = z.string().uuid();
const policyModeSchema = z.enum(['off', 'review_required', 'unattended']);
const proposalStatusSchema = z.enum([
  'pending_review', 'approved', 'rejected', 'executing',
  'blocked', 'failed', 'succeeded', 'unknown',
]);
const outcomeStatusSchema = z.enum([
  'pending', 'submitted', 'blocked', 'failed', 'succeeded', 'unknown',
]);

const policySchema = z.strictObject({
  profileId: z.string().min(1).max(64),
  mode: policyModeSchema,
  revision: z.number().int().nonnegative(),
  provenanceHash: sha256HexSchema,
  confirmedAt: epochMillisecondsSchema,
  updatedAt: epochMillisecondsSchema,
  source: z.enum(['default', 'stored']),
}).readonly();

const proposalSchema = z.strictObject({
  id: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  revision: z.number().int().positive(),
  proposalHash: sha256HexSchema,
  status: proposalStatusSchema,
  createdAt: epochMillisecondsSchema,
  updatedAt: epochMillisecondsSchema,
  reasonCode: z.string().min(1).max(80).nullable(),
  decisionId: sha256HexSchema.nullable(),
  evidenceId: sha256HexSchema.nullable(),
  actions: z.array(z.strictObject({
    productId: z.string().min(1).max(64),
    side: z.enum(['buy', 'sell']),
    amountUsd: decimalStringSchema,
    origin: z.literal('rebalance'),
  }).readonly()).max(200).readonly(),
  review: z.strictObject({
    decision: z.enum(['human_approved', 'human_rejected', 'system_not_required']),
    reviewer: z.string().min(1).max(80),
    note: z.string().max(500),
    decidedAt: epochMillisecondsSchema,
  }).readonly().nullable(),
}).readonly();

const executionResultSchema = z.strictObject({
  status: outcomeStatusSchema,
  proposalId: z.string().min(1).max(128),
  proposalHash: sha256HexSchema,
  reasonCode: z.string().min(1).max(80).nullable(),
  filledCount: z.number().int().nonnegative(),
  refusedCount: z.number().int().nonnegative(),
}).readonly();

const campaignSchema = z.strictObject({
  id: sha256HexSchema,
  kind: z.enum(['zero_edge_stand_down', 'validated_unattended']),
  startDayUtc: epochMillisecondsSchema,
  requiredDays: z.literal(7),
  observedDays: z.number().int().min(0).max(7),
  killSwitchExercised: z.boolean(),
  killSwitchAcknowledged: z.boolean(),
  reconciled: z.boolean(),
  state: z.enum(['registered', 'running', 'completed', 'failed']),
}).readonly().nullable();

const connectionCampaignSchema = z.strictObject({
  campaignId: sha256HexSchema, sourceUnifiedSnapshotId: sha256HexSchema,
  startedAtMs: epochMillisecondsSchema, connectionCount: z.number().int().positive(),
  connections: z.array(z.strictObject({ connectionId: sha256HexSchema,
    provider: z.enum(['coinbase', 'robinhood_crypto']), cashUsd: decimalStringSchema,
    balanceCount: z.number().int().nonnegative(), sourceConnectionSnapshotId: sha256HexSchema,
  }).readonly()).max(100).readonly(),
}).readonly().nullable();

const exploratoryCampaignSchema = z.strictObject({
  schemaVersion: z.literal(1), campaignId: sha256HexSchema,
  profileId: z.string().min(1).max(64), commandId: z.string().min(1).max(128),
  admissionMode: z.literal('exploratory'), strategyId: z.literal('trendvol-exploratory-paper-v1'),
  sourcePortfolioSnapshotId: sha256HexSchema, sourcePortfolioHash: sha256HexSchema,
  strategyConfigHash: sha256HexSchema, strategyCodeHash: sha256HexSchema,
  costModelHash: sha256HexSchema,
  baseWeights: z.array(z.strictObject({ assetId: z.string().min(1).max(128),
    weight: z.number().finite().min(0).max(1) }).readonly()).max(100).readonly(),
  baseWeightsHash: sha256HexSchema,
  openingBalances: z.array(z.strictObject({
    exposureKey: z.string().min(1).max(32), assetId: z.string().min(1).max(128).nullable(),
    quantity: decimalStringSchema, priceUsd: decimalStringSchema, valueUsd: decimalStringSchema,
    managed: z.boolean(), contributions: z.array(z.strictObject({ connectionId: sha256HexSchema,
      accountRefId: sha256HexSchema, provider: z.enum(['coinbase', 'robinhood_crypto']),
      quantity: decimalStringSchema, valueUsd: decimalStringSchema }).readonly()).max(100).readonly(),
  }).readonly()).max(500).readonly(),
  openingCashUsd: decimalStringSchema,
  openingCashProvenance: z.enum(['connected_snapshot', 'unknown_assumed_zero']),
  openingEquityUsd: decimalStringSchema,
  startedAtMs: epochMillisecondsSchema, eligibleForValidation: z.literal(false),
  eligibleForPromotion: z.literal(false), eligibleForLiveExecution: z.literal(false),
  contentHash: sha256HexSchema,
}).readonly();

const exploratoryStatusSchema = z.strictObject({
  campaign: exploratoryCampaignSchema,
  status: z.enum(['active', 'paused', 'stopping', 'stopped']),
  revision: z.number().int().nonnegative(), updatedAtMs: epochMillisecondsSchema,
}).readonly();

const exploratoryPortfolioSchema = z.strictObject({
  campaign: exploratoryCampaignSchema,
  status: z.enum(['active', 'paused', 'stopping', 'stopped']), asOfMs: epochMillisecondsSchema,
  simulation: z.literal(true), primary: z.boolean(), simulationVenue: z.literal('Coinbase reference'),
  balances: z.array(z.strictObject({ exposureKey: z.string().min(1).max(32),
    assetId: z.string().min(1).max(128).nullable(), quantity: decimalStringSchema,
    valueUsd: decimalStringSchema.nullable(), managed: z.boolean() }).readonly()).max(500).readonly(),
  openingEquityUsd: decimalStringSchema, currentEquityUsd: decimalStringSchema.nullable(),
  connectedReferenceEquityUsd: decimalStringSchema.nullable(),
  buyAndHoldBenchmarkUsd: decimalStringSchema.nullable(), estimatedCostsUsd: decimalStringSchema,
  valuationStatus: z.enum(['complete', 'incomplete', 'stale']),
  paperReturnPct: z.number().finite().nullable(),
  benchmarkDifferencePct: z.number().finite().nullable(),
  drawdownPct: z.number().finite().nonnegative().nullable(),
  counts: z.strictObject({ submitted: z.number().int().nonnegative(), filled: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(), expired: z.number().int().nonnegative(),
    refused: z.number().int().nonnegative(), noTrade: z.number().int().nonnegative() }).readonly(),
}).readonly();

const exploratoryRunSchema = z.strictObject({
  profileId: z.string().min(1).max(64), runId: sha256HexSchema,
  strategyVersion: z.literal('trendvol-exploratory-paper-v1'),
  scheduledForMs: epochMillisecondsSchema, decidedAtMs: epochMillisecondsSchema,
  standDown: z.string().nullable(), filledCount: z.number().int().nonnegative(),
  submittedCount: z.number().int().nonnegative(), refusedCount: z.number().int().nonnegative(),
  preDecisionBalances: z.array(z.strictObject({ assetId: z.string(), quantity: decimalStringSchema }).readonly()).max(500).readonly(),
}).readonly();

export const paperExecutionChannelSchemas = {
  'paper.campaign': {
    request: emptyPayloadSchema,
    response: campaignSchema,
  },
  'paper.campaign.kill-switch': {
    request: z.strictObject({
      commandId: commandIdSchema,
      action: z.enum(['exercise', 'acknowledge']),
      explicitConfirmation: z.literal(true),
    }).readonly(),
    response: campaignSchema,
  },
  'paper.campaign.connections': { request: emptyPayloadSchema, response: connectionCampaignSchema },
  'paper.campaign.connections.start': {
    request: z.strictObject({ commandId: commandIdSchema, explicitConfirmation: z.literal(true) }).readonly(),
    response: connectionCampaignSchema.unwrap(),
  },
  'paper.exploratory.status': { request: emptyPayloadSchema, response: exploratoryStatusSchema.nullable() },
  'paper.exploratory.start': {
    request: z.strictObject({ commandId: commandIdSchema, explicitConfirmation: z.literal(true) }).readonly(),
    response: exploratoryStatusSchema,
  },
  'paper.exploratory.pause': {
    request: z.strictObject({ commandId: commandIdSchema, campaignId: sha256HexSchema }).readonly(),
    response: exploratoryStatusSchema,
  },
  'paper.exploratory.resume': {
    request: z.strictObject({ commandId: commandIdSchema, campaignId: sha256HexSchema }).readonly(),
    response: exploratoryStatusSchema,
  },
  'paper.exploratory.stop': {
    request: z.strictObject({ commandId: commandIdSchema, campaignId: sha256HexSchema,
      explicitConfirmation: z.literal(true) }).readonly(), response: exploratoryStatusSchema,
  },
  'paper.exploratory.evaluate-now': {
    request: z.strictObject({ commandId: commandIdSchema }).readonly(), response: exploratoryRunSchema,
  },
  'paper.exploratory.portfolio': { request: emptyPayloadSchema, response: exploratoryPortfolioSchema.nullable() },
  'paper.exploratory.performance': {
    request: emptyPayloadSchema,
    response: z.strictObject({ points: z.array(z.strictObject({ schemaVersion: z.literal(1),
      id: sha256HexSchema, campaignId: sha256HexSchema, profileId: z.string().min(1).max(64),
      asOfMs: epochMillisecondsSchema, equityUsd: decimalStringSchema.nullable(),
      buyAndHoldBenchmarkUsd: decimalStringSchema.nullable(), estimatedCostsUsd: decimalStringSchema,
      unpricedCount: z.number().int().nonnegative(), contentHash: sha256HexSchema,
    }).readonly()).max(5000).readonly() }).readonly(),
  },
  'paper.execution.policy': {
    request: emptyPayloadSchema,
    response: policySchema,
  },
  'paper.execution.policy.set': {
    request: z.strictObject({
      commandId: commandIdSchema,
      mode: policyModeSchema,
      explicitUnattendedConfirmation: z.boolean(),
    }).readonly(),
    response: policySchema,
  },
  'paper.execution.proposals': {
    request: z.strictObject({ limit: z.number().int().min(1).max(200) }).readonly(),
    response: z.strictObject({ proposals: z.array(proposalSchema).max(200).readonly() }).readonly(),
  },
  'paper.execution.proposal': {
    request: z.strictObject({ proposalId: z.string().min(1).max(128) }).readonly(),
    response: proposalSchema,
  },
  'paper.execution.prepare': {
    // No amounts or sides cross from the renderer. Main recomputes the current
    // allocation proposal; this cannot become an arbitrary paper trade form.
    request: z.strictObject({ commandId: commandIdSchema }).readonly(),
    response: executionResultSchema,
  },
  'paper.execution.review': {
    request: z.strictObject({
      commandId: commandIdSchema,
      proposalId: z.string().min(1).max(128),
      proposalHash: sha256HexSchema,
      decision: z.enum(['approve', 'reject']),
      reviewer: z.string().min(1).max(80),
      note: z.string().max(500),
    }).readonly(),
    response: executionResultSchema,
  },
} as const;
