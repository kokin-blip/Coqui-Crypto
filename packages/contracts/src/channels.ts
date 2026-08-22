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
 * Every channel is a read.
 *
 * Write channels will arrive with the paper engine in P6 and the Coinbase
 * connect flow in P7. Keeping the distinction explicit from the start means the
 * boundary can require confirmation semantics on writes rather than retrofitting
 * them: `docs/UI-UX.md` §3.1 forbids optimistic success on financial,
 * credential, kill-switch, export, and destructive actions, and that rule is
 * enforceable only if the transport knows which channels those are.
 */
export const CHANNEL_KINDS = {
  read: CHANNEL_NAMES,
  write: [] as readonly ChannelName[],
} as const;
