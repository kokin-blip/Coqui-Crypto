import * as z from 'zod';

import { epochMillisecondsSchema } from '../messages.js';
import { decimalStringSchema } from './provenance.js';

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
  'alpaca.paper.performance': {request:z.strictObject({scopeId:z.string().min(1).max(160),connectionId:z.string().min(1).max(160).nullable()}),
    response:z.strictObject({scopeId:z.string(),accountSuffix:z.string().max(6),asOfMs:epochMillisecondsSchema,
      equityUsd:decimalStringSchema,openingEquityUsd:decimalStringSchema,equityChangeUsd:decimalStringSchema,
      historyAtMs:epochMillisecondsSchema.nullable(),historyEquityUsd:decimalStringSchema.nullable(),cashAdjustmentsUsd:decimalStringSchema.nullable(),
      cashReconciliation:z.strictObject({reconciled:z.boolean(),residualUsd:decimalStringSchema.nullable(),journalDetailsComplete:z.boolean(),fillCount:z.number().int().nonnegative()}).nullable(),
      netPnlUsd:decimalStringSchema.nullable(),netPnlReason:z.enum(['cash_reconciled','cash_adjustments_require_reconciliation','fill_fee_and_cashflow_reconciliation_required']),paperOnly:z.literal(true)})},
  'alpaca.paper.status': { request: z.strictObject({}).readonly(), response: status },
  'alpaca.paper.connect': {
    request: z.strictObject({ commandId, keyId: z.string().trim().min(1).max(256),
      secretKey: z.string().trim().min(1).max(512) }).readonly(), response: status,
  },
  'alpaca.paper.refresh': { request: z.strictObject({ commandId }).readonly(), response: status },
  'alpaca.paper.disconnect': { request: z.strictObject({ commandId }).readonly(), response: status },
} as const;
