import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const commandId = z.string().uuid();
const status = z.strictObject({
  state: z.enum(['disconnected', 'connected', 'attention_required']),
  accountSuffix: z.string().max(8).nullable(),
  cashUsd: z.string().nullable(),
  equityUsd: z.string().nullable(),
  lastCheckedAtMs: epochMillisecondsSchema.nullable(),
  reasonCode: z.string().max(80).nullable(),
  paperOnly: z.literal(true),
}).readonly();

export const alpacaPaperChannelSchemas = {
  'alpaca.paper.status': { request: z.strictObject({}).readonly(), response: status },
  'alpaca.paper.connect': {
    request: z.strictObject({ commandId, keyId: z.string().trim().min(1).max(256),
      secretKey: z.string().trim().min(1).max(512) }).readonly(), response: status,
  },
  'alpaca.paper.refresh': { request: z.strictObject({ commandId }).readonly(), response: status },
  'alpaca.paper.disconnect': { request: z.strictObject({ commandId }).readonly(), response: status },
} as const;
