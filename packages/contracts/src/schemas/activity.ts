import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const activityEventSchema = z.strictObject({
  id: z.string().min(1).max(260),
  kind: z.enum(['decision', 'market', 'risk', 'research', 'routing', 'paper', 'fill', 'alert', 'reconciliation', 'failure', 'host']),
  status: z.enum(['info', 'pending', 'succeeded', 'blocked', 'failed', 'unknown']),
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(500),
  occurredAt: epochMillisecondsSchema,
  provenance: z.string().min(1).max(128).nullable(),
  decisionId: z.string().length(64).nullable(),
  evidenceId: z.string().min(1).max(128).nullable(),
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u).nullable(),
  assetScopes: z.array(z.string().regex(/^(?:GLOBAL|[A-Z0-9][A-Z0-9._-]{0,31})$/u)).max(100).readonly(),
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
