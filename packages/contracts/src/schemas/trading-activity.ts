import * as z from 'zod';
import { epochMillisecondsSchema as time } from '../messages.js';
import { decimalStringSchema as money } from './provenance.js';
import { decisionChannelSchemas } from './decisions.js';
const id = z.string().min(1).max(160);
const source = z.enum(['paper_ledger','exploratory','parallel_coqui','alpaca_paper']);
const scope = z.strictObject({ id, profileId: id, source, campaignId: id.nullable(), label: z.string().max(200), combined: z.boolean(), current: z.boolean() });
const filter = { scopeId: id, connectionId: id.nullable() };
const entry = z.strictObject({ id, profileId: id, scopeId: id, source, campaignId: id.nullable(), instrumentKey:id.nullable(), accountId:id.nullable(), connectionId: id.nullable(), productId: id,
  kind: z.enum(['proposal','review','order','fill']), status: z.string().max(80), atMs: time,
  side: z.enum(['buy','sell']).nullable(), quantity: money.nullable(), amountUsd: money.nullable(), realizedPnlUsd: money.nullable(), priceUsd: money.nullable(), feeUsd: money.nullable(),
  spreadUsd: money.nullable(), slippageUsd: money.nullable(), impactUsd: money.nullable(),
  proposalId: id.nullable(), decisionId: id.nullable(), orderId: id.nullable(), reason: z.string().max(1000).nullable(),
  timestampSource: z.enum(['recorded_fill','recorded_event','recorded_event_fill_time_unavailable']),
});
const position = z.strictObject({ productId: id, scopeId: id, quantity: money, entryAtMs: time.nullable(), averageEntryUsd: money.nullable(),
  markUsd: money.nullable(), markSource: z.string().max(100).nullable(), markAtMs: time.nullable(),
  valuation: z.enum(['fresh','stale','unavailable','partial']), basisComplete: z.boolean(), knownBasisUsd: money, knownQuantity: money,
  unrealizedPnlUsd: money.nullable(), unrealizedPnlPct: money.nullable(), knownUnrealizedPnlUsd: money.nullable(),
  realizedPnlUsd: money.nullable(), knownRealizedPnlUsd: money, realizedComplete: z.boolean(),
  status: z.enum(['holding','closed','watching']), exits: z.array(z.strictObject({ fillId: id, atMs: time,
    price: money, quantity: money, realizedPnlUsd: money.nullable(), feeUsd: money.nullable() })).max(200),
});
const watching = z.strictObject({ atMs: time, strategy: z.string().max(200), intent: z.string().max(120), reason: z.string().max(1000).nullable(),
  targetWeightPct: money.nullable(), risk: z.string().max(120), signals: z.array(z.strictObject({ label:z.string().max(100),value:z.string().max(200) })).max(30),
  decisionId: id.nullable(), shared: z.boolean() });
export const tradingActivityChannelSchemas = {
  'trading.activity.scopes': { request:z.strictObject({}), response:z.strictObject({ profileId:id,scopes:z.array(scope).max(100),
    wallets:z.array(z.strictObject({id,label:z.string().max(200)})).max(100),asOfMs:time }) },
  'trading.activity.summary': { request:z.strictObject({...filter,productId:id}), response:z.strictObject({ profileId:id,scope,
    positions:z.array(position).max(500),watching:watching.nullable(),decision:decisionChannelSchemas['decision.detail'].response.nullable(),
    annotations:z.array(entry).max(200),historyComplete:z.boolean(),asOfMs:time }) },
  'trading.activity.trail': { request:z.strictObject({...filter,productId:id,cursor:z.string().max(200).nullable(),limit:z.number().int().min(1).max(100)}),
    response:z.strictObject({ profileId:id,items:z.array(entry).max(100),nextCursor:z.string().max(200).nullable(),historyComplete:z.boolean(),asOfMs:time }) },
  'trading.activity.shared': { request:z.strictObject({productId:id,limit:z.number().int().min(1).max(32)}), response:z.strictObject({items:z.array(z.strictObject({
    profileId:id,profileName:z.string().max(200),watching,contextOnly:z.literal(true)})).max(32),unavailableProfiles:z.array(id).max(32),asOfMs:time}) },
} as const;
