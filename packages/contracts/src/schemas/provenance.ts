import * as z from 'zod';

import { epochMillisecondsSchema, type DeepReadonly } from '../messages.js';

/**
 * Wire form of the provenance every displayed figure must carry
 * (`ARCHITECTURE.md` §9). It is a functional requirement, not decoration, so it
 * is part of the contract rather than something a screen adds later.
 */
export const referenceFreshnessSchema = z.enum(['fresh', 'aging', 'stale', 'unknown']);

export const referenceProvenanceSchema = z
  .strictObject({
    source: z.string().min(1).max(128),
    requestedAtMs: epochMillisecondsSchema,
    receivedAtMs: epochMillisecondsSchema,
    observedAtMs: epochMillisecondsSchema.nullable(),
    ageMs: z.number().int().nullable(),
    freshness: referenceFreshnessSchema,
    /**
     * Literal `true` rather than a boolean: the wire type itself refuses to
     * describe reference data as anything else, so a renderer cannot route it
     * through a decision-grade component by supplying `false`.
     */
    informationalOnly: z.literal(true),
    neverASignal: z.literal(true),
  })
  .readonly();

/** Provenance for canonical Coinbase bars, which are decision-grade. */
export const barProvenanceSchema = z
  .strictObject({
    source: z.literal('coinbase'),
    requestedAtMs: epochMillisecondsSchema,
    receivedAtMs: epochMillisecondsSchema,
    interval: z.literal('1d'),
    completedBarsOnly: z.literal(true),
    informationalOnly: z.literal(false),
  })
  .readonly();

/** Wrap a payload schema in the reference provenance every reference view carries. */
export function referenceViewSchema<TDataSchema extends z.ZodType>(dataSchema: TDataSchema) {
  return z
    .strictObject({
      data: dataSchema,
      provenance: referenceProvenanceSchema,
    })
    .readonly();
}

export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a sha-256 digest.');

export const instrumentIdentitySchema = z
  .strictObject({
    venue: z.enum(['coinbase', 'binance', 'kraken']),
    productId: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,63}$/, 'Expected a canonical product id.'),
    productType: z.literal('spot'),
  })
  .readonly();

/**
 * Money crosses the wire as an exact decimal string. Invariant 11 forbids
 * binary float for any balance or price, and JSON numbers are binary float.
 */
export const decimalStringSchema = z
  .string()
  .regex(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/, 'Expected an exact decimal string.')
  .max(64);

export type ReferenceFreshness = z.infer<typeof referenceFreshnessSchema>;
export type ReferenceProvenance = DeepReadonly<z.infer<typeof referenceProvenanceSchema>>;
export type BarProvenance = DeepReadonly<z.infer<typeof barProvenanceSchema>>;
export type InstrumentIdentityContract = DeepReadonly<z.infer<typeof instrumentIdentitySchema>>;
