import type { Clock } from '@coqui/core';
import { latestPaperCampaign, type Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';
import { handlePaperCampaignKillSwitch } from './forward-edge-runtime.js';

export function createPaperCampaignHandlers(
  profileId: string,
  clock: Clock,
  database: Db,
): ChannelHandlers {
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
  };
}
