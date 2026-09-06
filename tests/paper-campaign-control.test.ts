import { describe, expect, it } from 'vitest';

import {
  captureScheduledForwardEvidence,
  handlePaperCampaignKillSwitch,
  retireIncompatiblePaperCampaign,
} from '../apps/desktop/src/main/forward-edge-runtime.js';
import { SHIPPED_FORWARD_EDGE_PLAN } from '../apps/desktop/src/main/forward-edge-plan.js';
import { FixedClock } from '../packages/core/src/index.js';
import {
  activateWalletSafetyStop,
  appendPaperCampaignEvent,
  ensurePaperCampaign,
  getWalletSafetyStop,
  openDatabase,
  readPaperCampaign,
} from '../packages/storage/src/index.js';

const DAY = 86_400_000;

describe('paper campaign safety-stop control', () => {
  it('retires a strategy-mismatched campaign without deleting its observations', () => {
    const database = openDatabase(':memory:');
    const start = 20_000 * DAY;
    const campaign = ensurePaperCampaign({
      profileId: 'main', kind: 'zero_edge_stand_down',
      startDayUtc: start, registeredAt: start,
    }, database);
    appendPaperCampaignEvent({
      campaignId: campaign.id,
      dayUtc: start,
      runId: 'observed-run',
      status: 'observed',
      at: start,
      detail: { preserved: true },
    }, database);

    const input = {
      profileId: 'main',
      strategyVersion: 'allocation-policy-rebalancer-v1',
      expectedStrategyId: 'trendvol-legacy-unvalidated',
      runId: 'mismatch-run',
      at: start + 1,
      database,
    };
    expect(retireIncompatiblePaperCampaign(input)).toMatchObject({
      id: campaign.id,
      observedDays: 1,
      state: 'failed',
    });
    expect(retireIncompatiblePaperCampaign(input)).toMatchObject({
      observedDays: 1,
      state: 'failed',
    });
    database.close();
  });

  it('does not capture a forward observation for a mismatched strategy', async () => {
    const database = openDatabase(':memory:');
    const start = 20_000 * DAY;
    const campaign = ensurePaperCampaign({
      profileId: 'main', kind: 'zero_edge_stand_down',
      startDayUtc: start, registeredAt: start,
    }, database);

    await captureScheduledForwardEvidence({
      profileId: 'main',
      plan: SHIPPED_FORWARD_EDGE_PLAN,
      planHash: 'a'.repeat(64),
      summary: {
        profileId: 'main',
        runId: 'mismatched-capture',
        strategyVersion: 'allocation-policy-rebalancer-v1',
        scheduledForMs: start,
        decidedAtMs: start,
        standDown: 'no_intents',
        filledCount: 0,
        submittedCount: 0,
        refusedCount: 0,
        preDecisionBalances: [],
      },
      database,
      clock: new FixedClock(start),
      priceSource: {
        name: 'must-not-run',
        spot: async () => { throw new Error('mismatched capture reached valuation'); },
      },
      market: {
        bars: () => { throw new Error('mismatched capture reached market data'); },
        rules: () => null,
      },
    });

    expect(readPaperCampaign(campaign.id, database)?.state).toBe('failed');
    const count = database.prepare(
      'SELECT COUNT(*) AS count FROM forward_edge_observations_v1',
    ).get() as { count: number };
    expect(count.count).toBe(0);
    database.close();
  });

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
