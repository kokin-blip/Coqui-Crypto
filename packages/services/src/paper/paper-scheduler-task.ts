import { currentExploratoryPaperCampaign, recoverInterruptedPaperOrders } from '@coqui/storage';

import { PaperExecutionService } from './execution-service.js';
import { exploratoryPaperPortfolioView } from './exploratory-portfolio.js';
import { runExploratoryPaperDecision } from './exploratory-run-loop.js';
import { runPaperDecision } from './run-loop.js';
import type { PaperRunLoopDependencies } from './runtime-model.js';

export function recoverPaperOrdersAtStartup(
  dependencies: Pick<PaperRunLoopDependencies, 'database' | 'clock' | 'profileId'>,
): { readonly reconciled: number; readonly blocked: number } {
  return recoverInterruptedPaperOrders(
    dependencies.profileId,
    dependencies.clock.nowMs(),
    dependencies.database,
  );
}

export interface PaperSchedulerTask {
  readonly profileId: string;
  readonly cadenceMs: number;
  readonly utcOffsetMs?: number;
  readonly catchUpPolicy: 'recompute_current';
  execute(context: { readonly scheduledForMs: number }): Promise<{
    readonly status: 'completed' | 'degraded'; readonly reasonCode?: string;
  }>;
}

/** Adapts the slot-stable decision runtime to the host scheduler. */
export function createPaperRunLoopTask(
  dependencies: PaperRunLoopDependencies,
  cadenceMs = 86_400_000,
  utcOffsetMs = 0,
): PaperSchedulerTask {
  return {
    profileId: dependencies.profileId, cadenceMs, utcOffsetMs,
    catchUpPolicy: 'recompute_current',
    async execute(context) {
      try {
        const exploratory = currentExploratoryPaperCampaign(
          dependencies.profileId, dependencies.database,
        );
        if (exploratory !== null && exploratory.status === 'paused') {
          new PaperExecutionService({ database: dependencies.database,
            profileId: dependencies.profileId, nowMs: () => dependencies.clock.nowMs(),
            market: dependencies.market,
            state: () => ({ holdings: [], killSwitchEngaged: false, evidenceVerified: false,
              historicalGrossEdgeLowerBoundPct: null, admissionMode: 'exploratory',
              campaignId: exploratory.campaign.campaignId, exploratoryAuthorized: true }),
            ...(dependencies.executionOwnerId === undefined ? {} : {
              executionOwnerId: dependencies.executionOwnerId,
            }),
          }).settlePending();
          exploratoryPaperPortfolioView({ profileId: dependencies.profileId,
            database: dependencies.database, market: dependencies.market,
            nowMs: dependencies.clock.nowMs(), persistValuation: true });
          return { status: 'completed' };
        }
        if (exploratory !== null && exploratory.status !== 'active') return { status: 'completed' };
        const summary = exploratory === null
          ? runPaperDecision(dependencies, context.scheduledForMs)
          : runExploratoryPaperDecision(dependencies, context.scheduledForMs);
        if (exploratory !== null) {
          exploratoryPaperPortfolioView({ profileId: dependencies.profileId,
            database: dependencies.database, market: dependencies.market,
            nowMs: dependencies.clock.nowMs(), persistValuation: true });
        }
        await dependencies.captureEvidence?.(summary);
        return { status: 'completed' };
      } catch (error) {
        dependencies.onUnexpectedError?.('paper_run', error);
        return { status: 'degraded', reasonCode: 'paper_run_failed' };
      }
    },
  };
}
