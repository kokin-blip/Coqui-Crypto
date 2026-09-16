import type { Clock } from '@coqui/core';
import {
  ExploratoryPaperCampaignService,
  exploratoryPaperPortfolioView,
  runExploratoryPaperDecision,
  type PaperRunLoopDependencies,
} from '@coqui/services';
import { listExploratoryPaperValuations, type Db } from '@coqui/storage';

import type { ChannelHandlers } from './dispatch.js';
import type { PaperMarketFeed } from './paper-market.js';

export function createExploratoryPaperRuntime(input: {
  readonly profileId: string;
  readonly database: Db;
  readonly clock: Clock;
  readonly market: PaperMarketFeed;
  readonly campaigns: ExploratoryPaperCampaignService;
  readonly run: PaperRunLoopDependencies;
}) {
  const status = () => input.campaigns.status(input.profileId);
  const evaluate = async () => {
    const current = status();
    if (current === null || current.status !== 'active') {
      return { ok: false as const, issues: [{ path: [] as const,
        code: 'exploratory_campaign_not_active' }] };
    }
    const now = input.clock.nowMs();
    try { await input.market.refresh(now); } catch { /* refresh has its own catch; defence-in-depth */ }
    const scheduledForMs = Math.floor(now / 86_400_000) * 86_400_000;
    try {
      const summary = runExploratoryPaperDecision(input.run, scheduledForMs);
      exploratoryPaperPortfolioView({ profileId: input.profileId, database: input.database,
        market: input.market.view, nowMs: now, persistValuation: true });
      return { ok: true as const, value: summary };
    } catch (error) {
      return { ok: false as const, issues: [{ path: [] as const,
        code: error instanceof Error ? error.message : 'evaluate_unexpected_error' }] };
    }
  };
  const handlers: ChannelHandlers = {
    'paper.exploratory.status': () => ({ ok: true, value: status() }),
    'paper.exploratory.start': async (payload: {
      readonly commandId: string; readonly explicitConfirmation: true;
    }) => {
      const unified = input.campaigns.latestUnified(input.profileId);
      if (unified === null) return { ok: false, issues: [{ path: [], code: 'portfolio_unavailable' }] };
      const candidates = unified.exposures
        .filter((item) => item.exposureKey !== 'USD' && Number(item.quantity) > 0)
        .map((item) => ({ venue: 'coinbase' as const, productType: 'spot' as const,
          productId: `${item.exposureKey}-USD` }));
      const eligible = [] as typeof candidates;
      const now = input.clock.nowMs();
      for (const candidate of candidates) {
        const result = await input.market.refreshFor([candidate], now);
        if (result.ok) eligible.push(candidate);
      }
      const preparation = eligible.length === 0
        ? input.market.preparation()
        : await input.market.refreshFor(eligible, now);
      const result = input.campaigns.start({ profileId: input.profileId,
        commandId: payload.commandId, explicitConfirmation: payload.explicitConfirmation,
        preparation, instruments: eligible, nowMs: now });
      return result.ok
        ? { ok: true, value: status()! }
        : { ok: false, issues: [{ path: [], code: result.code }] };
    },
    'paper.exploratory.pause': (payload: { readonly commandId: string; readonly campaignId: string }) => {
      const result = input.campaigns.transition({ profileId: input.profileId, ...payload,
        action: 'pause', nowMs: input.clock.nowMs() });
      return result.ok ? { ok: true, value: result.value }
        : { ok: false, issues: [{ path: [], code: result.code }] };
    },
    'paper.exploratory.resume': (payload: { readonly commandId: string; readonly campaignId: string }) => {
      const result = input.campaigns.transition({ profileId: input.profileId, ...payload,
        action: 'resume', nowMs: input.clock.nowMs() });
      return result.ok ? { ok: true, value: result.value }
        : { ok: false, issues: [{ path: [], code: result.code }] };
    },
    'paper.exploratory.stop': (payload: { readonly commandId: string; readonly campaignId: string;
      readonly explicitConfirmation: true }) => {
      const result = input.campaigns.transition({ profileId: input.profileId,
        commandId: payload.commandId, campaignId: payload.campaignId,
        action: 'stop', nowMs: input.clock.nowMs() });
      return result.ok ? { ok: true, value: result.value }
        : { ok: false, issues: [{ path: [], code: result.code }] };
    },
    'paper.exploratory.evaluate-now': evaluate,
    'paper.exploratory.portfolio': () => ({ ok: true,
      value: exploratoryPaperPortfolioView({ profileId: input.profileId, database: input.database,
        market: input.market.view, nowMs: input.clock.nowMs() }) }),
    'paper.exploratory.performance': () => {
      const current = status();
      return { ok: true, value: { points: current === null ? []
        : listExploratoryPaperValuations(current.campaign.campaignId, input.profileId, input.database) } };
    },
  };
  return Object.freeze({ handlers, status, evaluate });
}
