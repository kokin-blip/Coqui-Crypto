import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const activityEventSchema = z.strictObject({
  id: z.string().min(1).max(260),
  kind: z.enum(['decision', 'paper', 'fill', 'alert', 'reconciliation', 'failure']),
  status: z.enum(['info', 'pending', 'succeeded', 'blocked', 'failed', 'unknown']),
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(500),
  occurredAt: epochMillisecondsSchema,
  provenance: z.string().min(1).max(128).nullable(),
}).readonly();

export const activityChannelSchemas = {
  'activity.feed': {
    request: z.strictObject({
      limit: z.number().int().min(1).max(100),
      cursor: z.string().min(3).max(400).nullable(),
    }).readonly(),
    response: z.strictObject({
      events: z.array(activityEventSchema).max(100).readonly(),
      nextCursor: z.string().min(3).max(400).nullable(),
      asOfMs: epochMillisecondsSchema,
    }).readonly(),
  },
} as const;
