import * as z from 'zod';
import { epochMillisecondsSchema } from '../messages.js';
import { decimalStringSchema, instrumentIdentitySchema } from './provenance.js';

const productId = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}-USD$/u);
const provenance = {
  instrument: instrumentIdentitySchema,
  source: z.literal('coinbase_exchange_ws'),
  informationalOnly: z.literal(true), decisionEligible: z.literal(false),
  connection: z.enum(['offline', 'connecting', 'live', 'stale', 'reconnecting']),
  asOfMs: epochMillisecondsSchema,
};
const level = z.strictObject({ price: decimalStringSchema, size: decimalStringSchema, total: decimalStringSchema }).readonly();

export const marketMicrostructureChannelSchemas = {
  'market-data.order-book': {
    request: z.strictObject({ productId,
      aggregation: decimalStringSchema.refine((v) => /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(v) && /[1-9]/u.test(v), 'Positive increment required'),
      limit: z.number().int().min(1).max(50) }).readonly(),
    response: z.strictObject({ ...provenance, aggregation: decimalStringSchema,
      state: z.enum(['ready', 'stale', 'unavailable']), observedAtMs: epochMillisecondsSchema.nullable(),
      bids: z.array(level).max(50).readonly(), asks: z.array(level).max(50).readonly() }).readonly(),
  },
  'market-data.recent-trades': {
    request: z.strictObject({ productId, limit: z.number().int().min(1).max(200) }).readonly(),
    response: z.strictObject({ ...provenance, incomplete: z.boolean(),
      trades: z.array(z.strictObject({ tradeId: z.string().regex(/^\d+$/u), price: decimalStringSchema,
        size: decimalStringSchema, takerSide: z.enum(['buy', 'sell']), observedAtMs: epochMillisecondsSchema,
      }).readonly()).max(200).readonly() }).readonly(),
  },
} as const;
