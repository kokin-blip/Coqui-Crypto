import * as z from 'zod';

import { accountsChannelSchemas } from './schemas/accounts.js';
import { marketDataChannelSchemas } from './schemas/market-data.js';
import { portfolioChannelSchemas } from './schemas/portfolio.js';
import { researchChannelSchemas } from './schemas/research.js';
import { riskChannelSchemas } from './schemas/risk.js';
import type { ContractSchema, DeepReadonly } from './messages.js';

/**
 * The single registry of every renderer-reachable channel.
 *
 * Both sides of the boundary read this object: the preload validates a request
 * against `request` before it leaves the renderer, and validates the reply
 * against `response` before it is handed back. A channel absent from here is
 * unreachable — the transport rejects it with `unknown_channel` rather than
 * forwarding an unrecognised string to `ipcMain`.
 *
 * It grows one screen at a time. `docs/handler-inventory.md` tracks the 140
 * predecessor handlers and which have a tested service boundary; a row reaches
 * this registry only once that boundary exists, so the registry can never claim
 * more than the services can honour.
 */
export const CHANNEL_SCHEMAS = {
  ...accountsChannelSchemas,
  ...marketDataChannelSchemas,
  ...portfolioChannelSchemas,
  ...researchChannelSchemas,
  ...riskChannelSchemas,
} as const;

export type ChannelSchemas = typeof CHANNEL_SCHEMAS;
export type ChannelName = keyof ChannelSchemas;

export const CHANNEL_NAMES = Object.keys(CHANNEL_SCHEMAS) as readonly ChannelName[];

export type ChannelRequestSchema<TChannel extends ChannelName> =
  ChannelSchemas[TChannel]['request'];
export type ChannelResponseSchema<TChannel extends ChannelName> =
  ChannelSchemas[TChannel]['response'];

export type ChannelRequest<TChannel extends ChannelName> = DeepReadonly<
  z.infer<ChannelRequestSchema<TChannel> & ContractSchema>
>;
export type ChannelResponse<TChannel extends ChannelName> = DeepReadonly<
  z.infer<ChannelResponseSchema<TChannel> & ContractSchema>
>;

export function isChannelName(value: unknown): value is ChannelName {
  return typeof value === 'string' && Object.hasOwn(CHANNEL_SCHEMAS, value);
}

/**
 * Reads and the one write.
 *
 * The distinction was kept explicit while `write` was empty precisely so that
 * the first write would not have to retrofit it. `docs/UI-UX.md` §3.1 forbids
 * optimistic success on financial, credential, kill-switch, export and
 * destructive actions, and that rule is enforceable only if the transport knows
 * which channels those are.
 *
 * P6's paper engine added no write channel and needed none: it is
 * scheduler-driven, so there is no user-initiated order. The first write is a
 * reconciliation *resolution* — a recorded decision about immutable evidence,
 * which changes no balance and no tax lot.
 */
const WRITE_CHANNELS = ['portfolio.reconciliation.resolve'] as const satisfies readonly ChannelName[];

export const CHANNEL_KINDS = {
  read: CHANNEL_NAMES.filter(
    (channel) => !(WRITE_CHANNELS as readonly ChannelName[]).includes(channel),
  ),
  write: WRITE_CHANNELS as readonly ChannelName[],
} as const;

export function isWriteChannel(channel: ChannelName): boolean {
  return (WRITE_CHANNELS as readonly ChannelName[]).includes(channel);
}
