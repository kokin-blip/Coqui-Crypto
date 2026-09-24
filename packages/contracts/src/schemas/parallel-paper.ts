import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const command = z.strictObject({ commandId: z.string().uuid() }).readonly();
const status = z.strictObject({
  experimentId: z.string().length(64).nullable(),
  state: z.enum(['none', 'active', 'paused', 'stopped']),
  startedAtMs: epochMillisecondsSchema.nullable(),
  coquiOpeningUsd: z.string().nullable(),
  alpacaOpeningUsd: z.string().nullable(),
  coquiEquityUsd: z.string().nullable(),
  alpacaEquityUsd: z.string().nullable(),
  coquiReturnPct: z.string().nullable(),
  alpacaReturnPct: z.string().nullable(),
  lastMarkDay: z.string().nullable(),
  decisionCount: z.number().int().nonnegative(),
  coquiFillCount: z.number().int().nonnegative(),
  alpacaFillCount: z.number().int().nonnegative(),
  alpacaOrderCount: z.number().int().nonnegative(),
  coquiFeesUsd: z.string(),
  alpacaBookedFeesUsd: z.string().nullable(),
  alpacaModeledFrictionUsd: z.string(),
  positions: z.array(z.strictObject({ symbol: z.string(), coquiQty: z.string(), alpacaQty: z.string(),
    coquiValueUsd: z.string(), alpacaValueUsd: z.string() }).readonly()).max(3).readonly(),
  targets: z.array(z.strictObject({ symbol: z.string(), weightPct: z.string() }).readonly()).max(3).readonly(),
  recentTrades: z.array(z.strictObject({ source: z.enum(['coqui', 'alpaca_paper']),
    atMs: epochMillisecondsSchema, symbol: z.string(), quantity: z.string(),
    price: z.string(), feeUsd: z.string().nullable() }).readonly()).max(20).readonly(),
  lastReason: z.string().max(80).nullable(),
  paperOnly: z.literal(true),
}).readonly();

export const parallelPaperChannelSchemas = {
  'parallel.paper.status': { request: z.strictObject({}).readonly(), response: status },
  'parallel.paper.start': { request: z.strictObject({ commandId: z.string().uuid(),
    smokeVerified: z.literal(true) }).readonly(), response: status },
  'parallel.paper.pause': { request: command, response: status },
  'parallel.paper.resume': { request: command, response: status },
  'parallel.paper.stop': { request: command, response: status },
} as const;
