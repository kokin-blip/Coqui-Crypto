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
