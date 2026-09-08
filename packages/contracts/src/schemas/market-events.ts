import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { sha256HexSchema } from './provenance.js';

const safeId = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/u);
const symbol = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}$/u);
const label = z.enum(['macro','regulatory','exchange','security','protocol','market_structure','other']);
const sentiment = z.enum(['positive','neutral','negative','unknown']);
const importance = z.enum(['low','medium','high']);
const eventInput = z.strictObject({ sourceEventId: z.string().min(1).max(200),
  title: z.string().min(1).max(240), summary: z.string().max(2_000).optional(),
  assetSymbols: z.array(symbol).max(32).readonly().optional(), publishedAtMs: epochMillisecondsSchema,
  firstSeenAtMs: epochMillisecondsSchema }).readonly();

export const marketEventChannelSchemas = {
  'market-events.ingest-local': {
    request: z.strictObject({ commandId: z.string().uuid(), sourceId: safeId,
      reference: z.string().min(1).max(300), confirmed: z.literal(true),
      events: z.array(eventInput).min(1).max(100).readonly() }).readonly(),
    response: z.strictObject({ results: z.array(z.strictObject({ eventId: sha256HexSchema,
      inserted: z.boolean(), contentHash: sha256HexSchema, classificationId: sha256HexSchema,
      triggerDecisions: z.array(z.strictObject({ triggerId: safeId, start: z.boolean(),
        reasonCode: z.enum(['started','debouncing','cooldown','trial_budget_exhausted','definition_unavailable']),
        deadlineAt: epochMillisecondsSchema.nullable(), jobId: sha256HexSchema.nullable() }).readonly()).max(100).readonly(),
      targetInfluence: z.literal(false), executionAuthority: z.literal(false) }).readonly()).max(100).readonly() }).readonly(),
  },
  'market-events.timeline': {
    request: z.strictObject({ asOfMs: epochMillisecondsSchema.nullable(), limit: z.number().int().min(1).max(200) }).readonly(),
    response: z.strictObject({ asOfMs: epochMillisecondsSchema, targetInfluence: z.literal(false),
      executionAuthority: z.literal(false), events: z.array(z.strictObject({ id: sha256HexSchema,
        sourceId: safeId, sourceEventId: z.string().min(1).max(200), title: z.string().min(1).max(240),
        summary: z.string().max(2_000), assetSymbols: z.array(symbol).max(32).readonly(),
        publishedAtMs: epochMillisecondsSchema, firstSeenAtMs: epochMillisecondsSchema,
        contentHash: sha256HexSchema, provenanceHash: sha256HexSchema,
        provenance: z.strictObject({ kind: z.literal('local_fixture'), reference: z.string().min(1).max(300) }).readonly(),
        classification: z.strictObject({ classificationId: sha256HexSchema, classificationHash: sha256HexSchema,
          classifier: z.enum(['deterministic','llm']), classifierVersion: safeId,
          label, sentiment, importance, classifiedAtMs: epochMillisecondsSchema }).readonly().nullable(),
      }).readonly()).max(200).readonly() }).readonly(),
  },
} as const;
