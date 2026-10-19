import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
const urlSchema = text(4_096).refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, 'Expected an HTTP(S) article URL without credentials.');

export const newsProviderIdSchema = z.enum(['marketaux', 'currents', 'gdelt']);
export const newsEntitySchema = z.strictObject({
  symbol: text(128),
  assetClass: z.enum(['crypto', 'equity', 'unknown']),
  providerEntityType: text(128).nullable(),
  exchange: text(128).nullable(),
  matchScore: z.number().nullable(),
  sentimentScore: z.number().min(-1).max(1).nullable(),
}).readonly();

const newsObservationV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  provider: newsProviderIdSchema,
  providerArticleId: text(256).nullable(),
  title: text(1_000),
  url: urlSchema,
  sourceDomain: text(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/iu),
  description: text(8_000).nullable(),
  publishedAtMs: epochMillisecondsSchema.nullable(),
  providerObservedAtMs: epochMillisecondsSchema.nullable(),
  observedAtMs: epochMillisecondsSchema,
  language: text(64).nullable(),
  entities: z.array(newsEntitySchema).max(100).readonly(),
}).readonly();

export const newsObservationSchema = z.union([
  newsObservationV1Schema,
  z.strictObject({ ...newsObservationV1Schema.unwrap().shape, schemaVersion: z.literal(2),
    transportProtocol: z.enum(['https', 'http']), }).readonly(),
]).refine(value => value.schemaVersion !== 2 || value.transportProtocol !== 'http' || value.provider === 'gdelt',
  'Only credential-free GDELT may use explicitly selected HTTP transport.');

export const newsQuerySchema = z.strictObject({
  symbols: z.array(text(128)).min(1).max(100).readonly().optional(),
  keywords: z.array(text(256)).min(1).max(100).readonly().optional(),
  publishedAfterMs: epochMillisecondsSchema.optional(),
  limit: z.number().int().min(1).max(250),
}).readonly();

export const newsFetchResultSchema = z.strictObject({
  articles: z.array(newsObservationSchema).max(250).readonly(),
  cursor: text(4_096).optional(),
  requestCost: z.number().int().nonnegative().safe(),
}).readonly();

/** Internal host settings only; deliberately absent from renderer channels. */
export const newsHostConfigurationSchema = z.object({
  schemaVersion: z.literal(1), gdeltEnabled: z.boolean(),
  gdeltTransport: z.enum(['https', 'http']).optional(),
}).strict().readonly();
