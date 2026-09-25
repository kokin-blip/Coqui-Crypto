import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';

const command = z.strictObject({ commandId: z.string().uuid() }).readonly();
const activity = z.strictObject({
  id: z.string().length(64),
  atMs: epochMillisecondsSchema,
  kind: z.enum(['decision', 'intent', 'submission', 'order', 'fill', 'no_trade', 'complete', 'paused', 'resumed', 'stopped']),
  title: z.string().max(120),
  detail: z.string().max(300),
  alpacaOrderId: z.string().max(128).nullable(),
}).readonly();
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
  runtimeState: z.enum(['none', 'awaiting', 'evaluating', 'order_pending', 'reconciled', 'paused', 'attention', 'stopped']),
  lastCheckAtMs: epochMillisecondsSchema.nullable(),
  lastDecisionAtMs: epochMillisecondsSchema.nullable(),
  latestDecision: z.strictObject({
    day: z.string(), exposurePct: z.string(), cashPct: z.string(), mixVolPct: z.string(),
    belowTrend: z.boolean(),
    targets: z.array(z.strictObject({ symbol: z.string(), weightPct: z.string() }).readonly()).max(3).readonly(),
  }).nullable(),
  activity: z.array(activity).max(20).readonly(),
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
