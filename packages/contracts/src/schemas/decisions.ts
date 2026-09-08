import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { decimalStringSchema, sha256HexSchema } from './provenance.js';

const assetScopeSchema = z.string().regex(/^(?:GLOBAL|[A-Z0-9][A-Z0-9._-]{0,31})$/u);
const assetFilterSchema = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}$/u);
const eventKindSchema = z.enum(['strategy_evaluated', 'risk_evaluated', 'execution_planned',
  'no_trade', 'stand_down', 'execution_submitted', 'execution_filled', 'execution_refused', 'recovery']);
const eventBase = {
  schemaVersion: z.literal(1), decisionId: sha256HexSchema,
  profileId: z.string().min(1).max(64), sequence: z.number().int().nonnegative(),
  atMs: epochMillisecondsSchema,
};
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...eventBase, kind: z.literal('strategy_evaluated'),
    detail: z.strictObject({ decisionHash: sha256HexSchema }).readonly() }).readonly(),
  z.strictObject({ ...eventBase, kind: z.literal('risk_evaluated'),
    detail: z.strictObject({ approved: z.boolean(), reasonCodes: z.array(z.string()).max(100).readonly(),
      assessmentHash: sha256HexSchema }).readonly() }).readonly(),
  z.strictObject({ ...eventBase, kind: z.literal('execution_planned'),
    detail: z.strictObject({ planId: z.string().min(1).max(128), planHash: sha256HexSchema,
      intentCount: z.number().int().nonnegative() }).readonly() }).readonly(),
  z.strictObject({ ...eventBase, kind: z.literal('no_trade'),
    detail: z.strictObject({ reasonCode: z.string(), estimatedTradeUsd: decimalStringSchema.nullable(),
      minimumUsefulTradeUsd: decimalStringSchema.nullable() }).readonly() }).readonly(),
  z.strictObject({ ...eventBase, kind: z.literal('stand_down'),
    detail: z.strictObject({ reasonCode: z.string() }).readonly() }).readonly(),
  z.strictObject({ ...eventBase, kind: z.literal('execution_submitted'),
    detail: z.strictObject({ proposalId: z.string(), proposalHash: sha256HexSchema,
      orderIds: z.array(z.string()).max(200).readonly() }).readonly() }).readonly(),
  z.strictObject({ ...eventBase, kind: z.literal('execution_filled'),
    detail: z.strictObject({ proposalId: z.string(), filledCount: z.number().int().nonnegative(),
      refusedCount: z.number().int().nonnegative() }).readonly() }).readonly(),
  z.strictObject({ ...eventBase, kind: z.literal('execution_refused'),
    detail: z.strictObject({ proposalId: z.string().nullable(), reasonCode: z.string(),
      refusedCount: z.number().int().nonnegative() }).readonly() }).readonly(),
  z.strictObject({ ...eventBase, kind: z.literal('recovery'),
    detail: z.strictObject({ orderId: z.string(),
      disposition: z.enum(['filled', 'cancelled', 'expired', 'unknown', 'reconciled']) }).readonly() }).readonly(),
]);

const timelineItemSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1).max(100),
  decisionId: sha256HexSchema, eventId: sha256HexSchema, kind: eventKindSchema,
  status: z.enum(['pending', 'succeeded', 'blocked', 'unknown']),
  occurredAtMs: epochMillisecondsSchema, reasonCode: z.string().nullable(),
  payloadHash: sha256HexSchema, assetScopes: z.array(assetScopeSchema).max(100).readonly(),
  globalScope: z.boolean(),
}).readonly();

const decisionSchema = z.strictObject({
  schemaVersion: z.literal(1), decisionId: sha256HexSchema,
  profileId: z.string().min(1).max(64), runId: z.string().min(1).max(128),
  scheduledForMs: epochMillisecondsSchema,
  strategy: z.strictObject({ id: z.string(), version: z.string(), configHash: sha256HexSchema }).readonly(),
  market: z.strictObject({ snapshotHash: sha256HexSchema.nullable(), asOfMs: epochMillisecondsSchema.nullable(),
    expectedAsOfMs: epochMillisecondsSchema.nullable(), freshness: z.enum(['fresh', 'stale', 'unavailable']),
    refreshResult: z.string(), ruleSnapshotHash: sha256HexSchema.nullable(), rulesFresh: z.boolean() }).readonly(),
  portfolio: z.strictObject({ snapshotHash: sha256HexSchema.nullable(), version: z.string().nullable(),
    source: z.enum(['profile_holdings', 'paper_ledger', 'unavailable']) }).readonly(),
  targets: z.array(z.strictObject({ assetId: z.string(), weight: z.number() }).readonly()).max(100).readonly(),
  cashWeight: z.number().nullable(), exposure: z.number().nullable(),
  historyStatus: z.enum(['complete', 'partial', 'insufficient', 'unavailable']),
  facts: z.strictObject({ momentum: z.array(z.strictObject({ assetId: z.string(),
    returnPct: z.number(), volatilityPct: z.number(), riskAdjustedMomentum: z.number() }).readonly()).max(100).readonly(),
    realizedVolPct: z.number().nullable(), belowTrend: z.boolean().nullable() }).readonly().nullable(),
  createdAtMs: epochMillisecondsSchema,
}).readonly();

export const decisionChannelSchemas = {
  'decision.timeline': {
    request: z.strictObject({ assetScope: assetFilterSchema.nullable(),
      asOfMs: epochMillisecondsSchema.nullable(), limit: z.number().int().min(1).max(100) }).readonly(),
    response: z.strictObject({ items: z.array(timelineItemSchema).max(100).readonly(),
      asOfMs: epochMillisecondsSchema }).readonly(),
  },
  'decision.detail': {
    request: z.strictObject({ decisionId: sha256HexSchema }).readonly(),
    response: z.strictObject({ schemaVersion: z.literal(1), decision: decisionSchema,
      decisionHash: sha256HexSchema, assetScopes: z.array(assetScopeSchema).max(100).readonly(),
      events: z.array(z.strictObject({ eventId: sha256HexSchema, payloadHash: sha256HexSchema,
        event: eventSchema }).readonly()).max(500).readonly(),
      routes: z.array(z.strictObject({ routeId: sha256HexSchema, connectionId: z.string(),
        provider: z.enum(['coinbase', 'robinhood_crypto']), exposureKey: assetFilterSchema,
        productId: z.string(), side: z.enum(['buy', 'sell']), amountUsd: decimalStringSchema,
        assumptionHash: sha256HexSchema, contentHash: sha256HexSchema }).readonly()).max(200).readonly(),
    }).readonly(),
  },
} as const;
