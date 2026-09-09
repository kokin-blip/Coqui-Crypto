import * as z from 'zod';

import { activityChannelSchemas } from './schemas/activity.js';
import { appChannelSchemas } from './schemas/app.js';
import { chartExtensionChannelSchemas } from './schemas/chart-extensions.js';
import { accountsChannelSchemas } from './schemas/accounts.js';
import { connectionChannelSchemas } from './schemas/connections.js';
import { advisorAnalystChannelSchemas } from './schemas/advisor-analyst.js';
import { marketDataChannelSchemas } from './schemas/market-data.js';
import { marketEventChannelSchemas } from './schemas/market-events.js';
import { operationsChannelSchemas } from './schemas/operations.js';
import { paperExecutionChannelSchemas } from './schemas/paper-execution.js';
import { paperPerformanceChannelSchemas } from './schemas/paper-performance.js';
import { portfolioChannelSchemas } from './schemas/portfolio.js';
import { researchChannelSchemas } from './schemas/research.js';
import { riskChannelSchemas } from './schemas/risk.js';
import { decisionChannelSchemas } from './schemas/decisions.js';
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
  ...activityChannelSchemas,
  ...appChannelSchemas,
  ...chartExtensionChannelSchemas,
  ...accountsChannelSchemas,
  ...connectionChannelSchemas,
  ...advisorAnalystChannelSchemas,
  ...marketDataChannelSchemas,
  ...marketEventChannelSchemas,
  ...operationsChannelSchemas,
  ...paperExecutionChannelSchemas,
  ...paperPerformanceChannelSchemas,
  ...portfolioChannelSchemas,
  ...researchChannelSchemas,
  ...riskChannelSchemas,
  ...decisionChannelSchemas,
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
const WRITE_CHANNELS = [
  'accounts.coinbase.connect',
  'accounts.coinbase.connect-json',
  'accounts.coinbase.disconnect',
  'accounts.coinbase.sync',
  'accounts.profile.switch',
  'accounts.settings.set',
  'accounts.workspace.set',
  'connections.connect-file',
  'connections.rename',
  'connections.disconnect',
  'connections.sync',
  'app.chart.snapshot.save',
  'app.chart.workspace.set',
  'advisor.chat.history.delete',
  'advisor.chat.history.export',
  'advisor.chat.send',
  'advisor.decision.explain',
  'advisor.evidence.explain',
  'advisor.facts.generate',
  'advisor.navigation',
  'advisor.provider.connect',
  'advisor.provider.disconnect',
  'chart-extensions.install',
  'chart-extensions.install.pick',
  'chart-extensions.remove',
  'chart-extensions.set',
  'chart-extensions.signer.remove',
  'chart-extensions.signer.trust',
  'market-events.ingest-local',
  'market-events.ingest-file',
  'paper.campaign.kill-switch',
  'paper.campaign.connections.start',
  'paper.execution.policy.set',
  'paper.execution.prepare',
  'paper.execution.review',
  'portfolio.reconciliation.resolve',
  'research.candidate.review',
  'research.candidate.rollback',
] as const satisfies readonly ChannelName[];

export const CHANNEL_KINDS = {
  read: CHANNEL_NAMES.filter(
    (channel) => !(WRITE_CHANNELS as readonly ChannelName[]).includes(channel),
  ),
  write: WRITE_CHANNELS as readonly ChannelName[],
} as const;

export function isWriteChannel(channel: ChannelName): boolean {
  return (WRITE_CHANNELS as readonly ChannelName[]).includes(channel);
}
