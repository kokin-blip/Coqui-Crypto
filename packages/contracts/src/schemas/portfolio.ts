import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { decimalStringSchema, instrumentIdentitySchema } from './provenance.js';

const emptyPayloadSchema = z.strictObject({}).readonly();

const assetRefSchema = z
  .strictObject({
    instrument: instrumentIdentitySchema,
    symbol: z.string().min(1).max(32),
    name: z.string().min(1).max(160),
    baseAsset: z.string().min(1).max(32),
    quoteAsset: z.literal('USD'),
    coingeckoId: z.string().min(1).max(128).nullable(),
  })
  .readonly();

/**
 * Per-holding price provenance.
 *
 * `observedAtMs` is **nullable** and that nullability is load-bearing: several
 * sources report a price without an observation time. A surface must render
 * "freshness unknown" as its own state, never as zero age, so the wire keeps
 * the distinction instead of substituting a timestamp.
 */
const holdingPriceProvenanceSchema = z
  .strictObject({
    source: z.string().min(1).max(64),
    quality: z.enum(['venue_reported_last', 'reference_market']),
    observedAtMs: epochMillisecondsSchema.nullable(),
  })
  .readonly();

const pricedHoldingSchema = z
  .strictObject({
    asset: assetRefSchema,
    quantity: decimalStringSchema,
    avgCostUsd: decimalStringSchema,
    // Null throughout when the holding could not be priced. A zero here would
    // silently drop the position from any total that sums these.
    priceUsd: decimalStringSchema.nullable(),
    valueUsd: decimalStringSchema.nullable(),
    unrealizedPnlUsd: decimalStringSchema.nullable(),
    unrealizedPnlPct: z.number().finite().nullable(),
    priceProvenance: holdingPriceProvenanceSchema.nullable(),
  })
  .readonly();

const valuationSchema = z
  .strictObject({
    /** Priced holdings only — a subtotal, not complete equity. */
    totalValueUsd: decimalStringSchema,
    totalCostUsd: decimalStringSchema,
    pricedCostUsd: decimalStringSchema,
    totalUnrealizedPnlUsd: decimalStringSchema,
    totalUnrealizedPnlPct: z.number().finite().nullable(),
    pricedCount: z.number().int().nonnegative(),
    unpricedCount: z.number().int().nonnegative(),
  })
  .readonly();

const pricingProvenanceSchema = z
  .strictObject({
    requestedSource: z.string().min(1).max(128),
    requestedAtMs: epochMillisecondsSchema,
    receivedAtMs: epochMillisecondsSchema,
    requestedCount: z.number().int().nonnegative(),
    pricedCount: z.number().int().nonnegative(),
    unpricedCount: z.number().int().nonnegative(),
    sources: z
      .array(
        z
          .strictObject({
            source: z.string().min(1).max(64),
            quality: z.enum(['venue_reported_last', 'reference_market']),
            pricedCount: z.number().int().nonnegative(),
          })
          .readonly(),
      )
      .max(8)
      .readonly(),
    status: z.enum(['not_required', 'complete', 'partial', 'unavailable', 'failed']),
  })
  .readonly();

/**
 * One unresolved reconciliation exception.
 *
 * There is no resolution field, and that is the contract, not an omission.
 * Invariant 12 makes an unexplained balance a user decision; the rows are
 * immutable by database trigger and closing one requires an explicit act
 * recorded elsewhere. A `resolved` boolean here would invite a UI that clears
 * them.
 */
const discrepancySchema = z
  .strictObject({
    id: z.string().min(1).max(128),
    runId: z.string().min(1).max(128),
    receivedAtMs: epochMillisecondsSchema,
    originProfileId: z.string().min(1).max(64),
    currency: z.string().min(1).max(32),
    kind: z.enum(['provider_exceeds_local', 'local_exceeds_provider']),
    providerQuantity: decimalStringSchema,
    localQuantity: decimalStringSchema,
    deltaQuantity: decimalStringSchema,
  })
  .readonly();

const allocationSliceSchema = z
  .strictObject({
    asset: assetRefSchema,
    valueUsd: decimalStringSchema,
    actualWeight: z.number().finite(),
    // Null when the policy has no target for this asset — distinct from a
    // target of zero, which is an explicit instruction to hold none.
    targetWeight: z.number().finite().nullable(),
    driftPct: z.number().finite().nullable(),
  })
  .readonly();

const rebalanceTradeSchema = z
  .strictObject({
    asset: assetRefSchema,
    side: z.enum(['buy', 'sell']),
    amountUsd: decimalStringSchema,
    estimatedQty: decimalStringSchema,
    reason: z.string().min(1).max(200),
  })
  .readonly();

const disposalSchema = z
  .strictObject({
    id: z.string().min(1).max(128),
    asset: assetRefSchema,
    quantity: decimalStringSchema,
    proceedsUsd: decimalStringSchema,
    costBasisUsd: decimalStringSchema,
    realizedPnlUsd: decimalStringSchema,
    longTerm: z.boolean(),
    disposedAt: epochMillisecondsSchema,
    method: z.enum(['fifo', 'lifo', 'hifo', 'average']),
    source: z.enum(['coinbase', 'manual', 'onchain']),
  })
  .readonly();

export const portfolioChannelSchemas = {
  'portfolio.allocation': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        policy: z
          .strictObject({
            targets: z
              .array(
                z
                  .strictObject({
                    instrument: instrumentIdentitySchema,
                    weight: z.number().finite().min(0).max(1),
                  })
                  .readonly(),
              )
              .max(100)
              .readonly(),
            rebalanceBandPct: z.number().finite().nonnegative(),
          })
          .readonly(),
        allocation: z
          .strictObject({
            slices: z.array(allocationSliceSchema).max(1000).readonly(),
            totalValueUsd: decimalStringSchema,
            asOf: epochMillisecondsSchema,
          })
          .readonly(),
        plan: z
          .strictObject({
            trades: z.array(rebalanceTradeSchema).max(200).readonly(),
            turnoverUsd: decimalStringSchema,
            maxDriftPct: z.number().finite(),
            asOf: epochMillisecondsSchema,
            /**
             * Literal `true`, carried across IPC on purpose. A rebalance plan
             * is an estimate that no executor may act on. Enforcing this only
             * at the type level in core would let the guarantee stop at the
             * process boundary.
             */
            estimateOnly: z.literal(true),
          })
          .readonly(),
        planStatus: z.enum([
          'available',
          'no_policy',
          'blocked_incomplete_pricing',
          'blocked_non_venue_pricing',
          'blocked_target_coverage',
        ]),
      })
      .readonly(),
  },
  'portfolio.tax': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        asOfMs: epochMillisecondsSchema,
        disposals: z.array(disposalSchema).max(2000).readonly(),
        summary: z
          .strictObject({
            ytdRealizedUsd: decimalStringSchema,
            allTimeRealizedUsd: decimalStringSchema,
            shortTermRealizedUsd: decimalStringSchema,
            longTermRealizedUsd: decimalStringSchema,
            ytdShortTermUsd: decimalStringSchema,
            ytdLongTermUsd: decimalStringSchema,
            disposalCount: z.number().int().nonnegative(),
          })
          .readonly(),
        years: z.array(z.number().int()).max(100).readonly(),
      })
      .readonly(),
  },
  'portfolio.view': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        asOfMs: epochMillisecondsSchema,
        holdings: z.array(pricedHoldingSchema).max(1000).readonly(),
        valuation: valuationSchema,
        pricing: pricingProvenanceSchema,
      })
      .readonly(),
  },
  'portfolio.reconciliation': {
    request: emptyPayloadSchema,
    response: z
      .strictObject({
        discrepancies: z.array(discrepancySchema).max(250).readonly(),
        lastRunAtMs: epochMillisecondsSchema.nullable(),
      })
      .readonly(),
  },
} as const;
