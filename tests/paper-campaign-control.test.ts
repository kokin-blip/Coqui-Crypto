import { describe, expect, it } from 'vitest';

import { handlePaperCampaignKillSwitch } from '../apps/desktop/src/main/forward-edge-runtime.js';
import {
  activateWalletSafetyStop,
  ensurePaperCampaign,
  getWalletSafetyStop,
  openDatabase,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;

describe('paper campaign safety-stop control', () => {
  it('requires a registered campaign and uses the normal acknowledgement path idempotently', () => {
    const database = openDatabase(':memory:');
    expect(handlePaperCampaignKillSwitch({
      profileId: 'main', commandId: 'missing', action: 'exercise',
      explicitConfirmation: true, at: 20_000 * DAY, database,
    })).toBeNull();
    ensurePaperCampaign({ profileId: 'main', kind: 'zero_edge_stand_down',
      startDayUtc: 20_000 * DAY, registeredAt: 20_000 * DAY }, database);
    const exercise = {
      profileId: 'main', commandId: 'exercise-1', action: 'exercise' as const,
      explicitConfirmation: true as const, at: 20_000 * DAY, database,
    };
    expect(handlePaperCampaignKillSwitch(exercise)?.killSwitchExercised).toBe(true);
    expect(handlePaperCampaignKillSwitch(exercise)?.killSwitchExercised).toBe(true);
    expect(getWalletSafetyStop('main', database)?.active).toBe(true);
    const acknowledge = {
      profileId: 'main', commandId: 'acknowledge-1', action: 'acknowledge' as const,
      explicitConfirmation: true as const, at: 20_000 * DAY + 1, database,
    };
    expect(handlePaperCampaignKillSwitch(acknowledge)?.killSwitchAcknowledged).toBe(true);
    expect(handlePaperCampaignKillSwitch(acknowledge)?.killSwitchAcknowledged).toBe(true);
    expect(getWalletSafetyStop('main', database)?.active).toBe(false);
    database.close();
  });

  it('rejects reusing a command identity for the opposite action', () => {
    const database = openDatabase(':memory:');
    ensurePaperCampaign({ profileId: 'main', kind: 'zero_edge_stand_down',
      startDayUtc: 20_000 * DAY, registeredAt: 20_000 * DAY }, database);
    handlePaperCampaignKillSwitch({ profileId: 'main', commandId: 'same', action: 'exercise',
      explicitConfirmation: true, at: 20_000 * DAY, database });
    expect(() => handlePaperCampaignKillSwitch({
      profileId: 'main', commandId: 'same', action: 'acknowledge',
      explicitConfirmation: true, at: 20_000 * DAY + 1, database,
    })).toThrow('identity cannot change');
    database.close();
  });

  it('cannot replace or acknowledge an unrelated active safety stop', () => {
    const database = openDatabase(':memory:');
    ensurePaperCampaign({ profileId: 'main', kind: 'zero_edge_stand_down',
      startDayUtc: 20_000 * DAY, registeredAt: 20_000 * DAY }, database);
    activateWalletSafetyStop({ eventId: 'risk-stop', profileId: 'main', kind: 'drawdown',
      reason: 'Risk hard-stop evidence.', at: 20_000 * DAY }, database);
    for (const action of ['exercise', 'acknowledge'] as const) {
      expect(() => handlePaperCampaignKillSwitch({
        profileId: 'main', commandId: action, action, explicitConfirmation: true,
        at: 20_000 * DAY + 1, database,
      })).toThrow('unrelated safety stop');
    }
    expect(getWalletSafetyStop('main', database)).toMatchObject({
      active: true, kind: 'drawdown',
    });
    database.close();
  });
});
