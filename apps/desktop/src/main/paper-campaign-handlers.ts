import type { Clock } from '@coqui/core';
import { latestPaperCampaign, type Db } from '@coqui/storage';
import { MultiConnectionPaperCampaignService } from '@coqui/services';

import type { ChannelHandlers } from './dispatch.js';
import { handlePaperCampaignKillSwitch } from './forward-edge-runtime.js';

export function createPaperCampaignHandlers(
  profileId: string,
  clock: Clock,
  database: Db,
): ChannelHandlers {
  const connections = new MultiConnectionPaperCampaignService(database, () => clock.nowMs());
  const connectionView = (value: ReturnType<typeof connections.status>) => value === null ? null : ({
    campaignId: value.campaign.id, sourceUnifiedSnapshotId: value.campaign.sourceUnifiedSnapshotId,
    startedAtMs: value.campaign.startedAtMs, connectionCount: value.books.length,
    connections: value.books.map((book) => ({ connectionId: book.connectionId, provider: book.provider,
      cashUsd: book.cashUsd, balanceCount: book.balances.length,
      sourceConnectionSnapshotId: book.sourceConnectionSnapshotId })),
  });
  return {
    'paper.campaign': () => ({ ok: true, value: latestPaperCampaign(profileId, database) }),
    'paper.campaign.kill-switch': (payload: {
      readonly commandId: string;
      readonly action: 'exercise' | 'acknowledge';
      readonly explicitConfirmation: true;
    }) => {
      const value = handlePaperCampaignKillSwitch({
        profileId, ...payload, at: clock.nowMs(), database,
      });
      return value === null
        ? { ok: false, issues: [{ path: ['campaign'], code: 'campaign_not_registered' }] }
        : { ok: true, value };
    },
    'paper.campaign.connections': () => ({ ok: true, value: connectionView(connections.status(profileId)) }),
    'paper.campaign.connections.start': (payload: { readonly commandId: string; readonly explicitConfirmation: true }) => {
      const result = connections.start(profileId, payload.commandId, payload.explicitConfirmation);
      return result.ok ? { ok: true, value: connectionView({ campaign: result.campaign, books: result.books })! }
        : { ok: false, issues: [{ path: ['campaign'], code: result.code }] };
    },
  };
}
