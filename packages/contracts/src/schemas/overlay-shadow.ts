import * as z from 'zod';
const status = z.strictObject({ enabled: z.boolean(), mode: z.literal('research_shadow'), qualified: z.literal(false),
  updatePolicy: z.literal('explicit'), asOfMs: z.number().int().nonnegative(), bindingHash: z.string().nullable(), pending: z.number().int().nonnegative(),
  reason: z.string(), arms: z.array(z.strictObject({ cadence: z.union([z.literal(1), z.literal(14)]), candidateId: z.string(),
    artifactHash: z.string().nullable(), equityUsd: z.string(), netPnlUsd: z.string(), costUsd: z.string(), modeledFills: z.number().int().nonnegative(), stopped: z.boolean() }).readonly()).readonly() }).readonly();
export const overlayShadowChannelSchemas = {
  'research.overlay-shadow.status': { request: z.strictObject({}).readonly(), response: status },
  'research.overlay-shadow.set': { request: z.strictObject({ commandId: z.string().min(1).max(200), enabled: z.boolean() }).readonly(), response: status },
} as const;
