import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { decimalStringSchema, sha256HexSchema } from './provenance.js';

const provider = z.enum(['coinbase', 'robinhood_crypto']);
const connection = z.strictObject({
  id: sha256HexSchema, profileId: z.string().min(1).max(64), provider,
  label: z.string().min(1).max(80), credentialFingerprint: sha256HexSchema,
  capabilities: z.array(z.enum(['account_read', 'market_read', 'paper_route'])).max(3).readonly(),
  status: z.enum(['active', 'attention_required', 'disconnected']),
  createdAtMs: epochMillisecondsSchema, updatedAtMs: epochMillisecondsSchema,
  accountSuffixes: z.array(z.string().min(4).max(12)).max(10_000).readonly(),
  lastSuccessfulSyncAtMs: epochMillisecondsSchema.nullable(),
  permissions: z.strictObject({
    accountRead: z.boolean(), marketRead: z.boolean(), orderRead: z.boolean(), trade: z.literal(false),
  }).readonly().nullable(),
  health: z.enum(['healthy', 'degraded', 'unavailable', 'unknown']),
  valuationComplete: z.boolean(), failureReason: z.string().min(1).max(80).nullable(),
  lifecycle: z.strictObject({ schemaVersion: z.literal(2),
    credentialVerification: z.enum(['verified','failed','unavailable']),
    synchronization: z.enum(['never','succeeded','failed']),
    health: z.enum(['healthy','degraded','unavailable','unknown']),
    valuation: z.enum(['complete','incomplete','unavailable']),
    portfolioReadiness: z.enum(['ready','blocked']), reasonCode: z.string().max(80).nullable(),
  }).readonly(),
  removalState: z.enum(['pending','removed','reactivated']).nullable(),
  readOnly: z.literal(true), liveExecutionAuthority: z.literal(false),
}).readonly();

const robinhoodPendingSetup = z.strictObject({
  setupId: z.string().uuid(), publicKeyBase64: z.string().min(40).max(48),
  expiresAtMs: epochMillisecondsSchema, privateKeyLocation: z.literal('os_keychain'),
}).readonly();

const contribution = z.strictObject({
  connectionId: sha256HexSchema, accountRefId: sha256HexSchema, provider,
  instrument: z.strictObject({ venue: z.enum(['coinbase', 'robinhood_crypto']), productId: z.string().min(1).max(64), productType: z.literal('spot') }).readonly().nullable(),
  quantity: decimalStringSchema, valueUsd: decimalStringSchema.nullable(),
}).readonly();

const exposure = z.strictObject({
  exposureKey: z.string().min(1).max(32), quantity: decimalStringSchema,
  valueUsd: decimalStringSchema.nullable(), contributions: z.array(contribution).max(10_000).readonly(),
}).readonly();

const currentPortfolio = z.strictObject({
  snapshotId: sha256HexSchema, profileId: z.string().min(1).max(64), asOfMs: epochMillisecondsSchema,
  connectionSnapshotIds: z.array(sha256HexSchema).max(100).readonly(),
  exposures: z.array(exposure).max(10_000).readonly(), totalValueUsd: decimalStringSchema.nullable(),
  complete: z.boolean(), source: z.literal('connected_accounts'),
}).readonly();

const commandId = z.string().uuid();

export const connectionChannelSchemas = {
  'connections.removal-preview': {
    request: z.strictObject({ connectionId: sha256HexSchema }).readonly(),
    response: z.strictObject({profileId:z.string(),connectionId:sha256HexSchema,label:z.string(),provider,
      status:z.enum(['active','attention_required','disconnected']),updatedAtMs:epochMillisecondsSchema,
      snapshotId:sha256HexSchema.nullable(),retainedSnapshots:z.number().int().nonnegative(),
      affectedBalances:z.array(z.strictObject({asset:z.string(),quantity:decimalStringSchema}).readonly()).readonly(),
      blockers:z.array(z.string()).readonly(),removalState:z.enum(['pending','removed','reactivated']).nullable(),
      revision:sha256HexSchema,eligible:z.boolean(),historyPreserved:z.literal(true)}).readonly(),
  },
  'connections.remove': {
    request:z.strictObject({commandId,connectionId:sha256HexSchema,revision:sha256HexSchema,confirmed:z.literal(true)}).readonly(),
    response:z.strictObject({connectionId:sha256HexSchema,outcome:z.literal('removed'),historyPreserved:z.literal(true)}).readonly(),
  },
  'wallets.list': {
    request:z.strictObject({}).readonly(),
    response:z.strictObject({profileId:z.string(),revision:sha256HexSchema.nullable(),scope:z.literal('installation'),
      wallets:z.array(z.strictObject({id:sha256HexSchema,connectionId:sha256HexSchema,provider,
        identityKind:z.enum(['portfolio','account']),maskedSuffix:z.string(),accountRefIds:z.array(sha256HexSchema).readonly(),nickname:z.string().nullable(),
        removed:z.boolean()}).readonly()).readonly()}).readonly(),
  },
  'wallets.nickname.set': {
    request:z.strictObject({commandId,walletId:sha256HexSchema,nickname:z.string().max(80).nullable(),revision:sha256HexSchema.nullable()}).readonly(),
    response:z.strictObject({walletId:sha256HexSchema,nickname:z.string().nullable(),revision:sha256HexSchema.nullable(),scope:z.literal('installation')}).readonly(),
  },

  'connections.list': {
    request: z.strictObject({}).readonly(),
    response: z.strictObject({ asOfMs: epochMillisecondsSchema, connections: z.array(connection).max(100).readonly() }).readonly(),
  },
  'connections.status': {
    request: z.strictObject({ connectionId: sha256HexSchema }).readonly(), response: connection,
  },
  'connections.connect-file': {
    request: z.strictObject({ commandId, provider, label: z.string().min(1).max(80).optional() }).readonly(), response: connection,
  },
  'connections.robinhood.keypair.begin': {
    request: z.strictObject({ commandId }).readonly(),
    response: robinhoodPendingSetup,
  },
  'connections.robinhood.keypair.status': {
    request: z.strictObject({}).readonly(),
    response: z.strictObject({ state: z.enum(['none','pending','unavailable']),
      setup: robinhoodPendingSetup.nullable(),
      reasonCode: z.enum(['secret_store_unavailable','pending_key_unavailable']).nullable() }).readonly(),
  },
  'connections.robinhood.keypair.complete': {
    request: z.strictObject({ commandId, setupId: z.string().uuid(), label: z.string().min(1).max(80).optional() }).readonly(),
    response: connection,
  },
  'connections.robinhood.keypair.cancel': {
    request: z.strictObject({ commandId, setupId: z.string().uuid() }).readonly(),
    response: z.strictObject({ outcome: z.literal('cancelled') }).readonly(),
  },
  'connections.rename': {
    request: z.strictObject({ commandId, connectionId: sha256HexSchema, label: z.string().min(1).max(80) }).readonly(), response: connection,
  },
  'connections.disconnect': {
    request: z.strictObject({ commandId, connectionId: sha256HexSchema, revision: sha256HexSchema.optional(), confirmed: z.literal(true).optional() }).readonly(), response: connection,
  },
  'connections.sync': {
    request: z.strictObject({ commandId, connectionId: sha256HexSchema }).readonly(), response: connection,
  },
  'portfolio.current': {
    request: z.strictObject({}).readonly(), response: currentPortfolio.nullable(),
  },
  'portfolio.history': {
    request: z.strictObject({ limit: z.number().int().min(1).max(5_000) }).readonly(),
    response: z.strictObject({ observations: z.array(z.strictObject({
      observedAtMs: epochMillisecondsSchema, totalValueUsd: decimalStringSchema,
      unifiedSnapshotId: sha256HexSchema,
    }).readonly()).max(5_000).readonly() }).readonly(),
  },
} as const;
