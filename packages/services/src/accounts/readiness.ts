import type { Clock } from '@coqui/core';
import {
  getAllocationPolicy,
  getLatestConnectionAccountSnapshotV2,
  getLatestUnifiedPortfolioSnapshotV2,
  latestMultiConnectionPaperCampaign,
  latestPaperCampaign,
  latestWalletDecisionRun,
  listMarketBars,
  listProfileConnectionsV2,
  type Db,
} from '@coqui/storage';

export type ProfileReadinessStepId = 'connection' | 'sync' | 'portfolio' | 'allocation' |
  'market_data' | 'paper_campaign' | 'first_decision';
export type ProfileReadinessStepStatus = 'complete' | 'current' | 'blocked' | 'pending';

export interface ProfileReadinessStepV1 {
  readonly id: ProfileReadinessStepId;
  readonly status: ProfileReadinessStepStatus;
  readonly title: string;
  readonly detail: string;
  readonly reasonCode: string | null;
  readonly route: string;
  readonly actionLabel: string;
}

export interface ProfileReadinessV1 {
  readonly schemaVersion: 1;
  readonly profileId: string;
  readonly stage: ProfileReadinessStepId | 'ready';
  readonly portfolioReady: boolean;
  readonly firstDecisionComplete: boolean;
  readonly steps: readonly ProfileReadinessStepV1[];
  readonly asOfMs: number;
}

const MIN_COMPLETED_BARS = 121;
const DAILY_FRESHNESS_MS = 48 * 60 * 60 * 1_000;

function positive(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export class ProfileReadinessService {
  constructor(private readonly database: Db, private readonly clock: Clock) {}

  view(profileId: string): ProfileReadinessV1 {
    const asOfMs = this.clock.nowMs();
    const connections = listProfileConnectionsV2(profileId, this.database)
      .filter((connection) => connection.status !== 'disconnected');
    const snapshots = connections.map((connection) =>
      getLatestConnectionAccountSnapshotV2(profileId, connection.id, this.database));
    const unified = getLatestUnifiedPortfolioSnapshotV2(profileId, false, this.database);
    const policy = getAllocationPolicy(this.database);
    const marketReady = policy.targets.length > 0 && policy.targets.every((target) => {
      const complete = listMarketBars(target.instrument, this.database).filter((bar) => bar.isComplete);
      const latest = complete.at(-1);
      return complete.length >= MIN_COMPLETED_BARS && latest !== undefined &&
        asOfMs - latest.endTimeMs <= DAILY_FRESHNESS_MS;
    });
    const campaignReady = latestMultiConnectionPaperCampaign(profileId, this.database) !== null ||
      latestPaperCampaign(profileId, this.database) !== null;
    const firstDecisionComplete = latestWalletDecisionRun(profileId, this.database) !== null;
    const portfolioReady = unified !== null && unified.complete && unified.totalValueUsd !== null &&
      unified.exposures.some((exposure) => positive(exposure.quantity));

    const facts = [
      { id: 'connection' as const, complete: connections.length > 0,
        blocked: false, title: 'Connect an account', detail: 'Add Coinbase or Robinhood account visibility.',
        reasonCode: 'connection_required', route: '#/settings', actionLabel: 'Open connections' },
      { id: 'sync' as const, complete: snapshots.length > 0 && snapshots.every((snapshot) => snapshot !== null),
        blocked: connections.length > 0 && snapshots.some((snapshot) => snapshot?.health === 'unavailable'),
        title: 'Sync account balances', detail: 'Verify access and retrieve the latest balances.',
        reasonCode: 'account_sync_required', route: '#/settings', actionLabel: 'Sync connections' },
      { id: 'portfolio' as const, complete: portfolioReady,
        blocked: unified !== null && !unified.complete, title: 'Review your portfolio',
        detail: unified !== null && !unified.complete ? 'Some holdings do not have a complete valuation.' : 'Confirm connected holdings and their valuation.',
        reasonCode: unified !== null && !unified.complete ? 'portfolio_valuation_incomplete' : 'portfolio_required',
        route: '#/portfolio/holdings', actionLabel: 'Review portfolio' },
      { id: 'allocation' as const, complete: policy.targets.length > 0, blocked: false,
        title: 'Set a base allocation', detail: 'Choose the asset weights used by the paper strategy.',
        reasonCode: 'allocation_policy_required', route: '#/portfolio/allocation', actionLabel: 'Set allocation' },
      { id: 'market_data' as const, complete: marketReady, blocked: policy.targets.length > 0 && !marketReady,
        title: 'Validate market history', detail: `Each target needs ${MIN_COMPLETED_BARS} aligned, fresh completed daily bars.`,
        reasonCode: 'decision_dataset_required', route: '#/markets', actionLabel: 'Review market data' },
      { id: 'paper_campaign' as const, complete: campaignReady, blocked: false,
        title: 'Start paper tracking', detail: 'Create an immutable simulated opening snapshot.',
        reasonCode: 'paper_campaign_required', route: '#/paper/overview', actionLabel: 'Open Paper' },
      { id: 'first_decision' as const, complete: firstDecisionComplete, blocked: false,
        title: 'Inspect the first decision', detail: 'Review what Coqui evaluated, concluded, and refused or submitted.',
        reasonCode: 'first_decision_pending', route: '#/activity', actionLabel: 'Open Activity' },
    ];
    const firstIncomplete = facts.findIndex((fact) => !fact.complete);
    const steps = facts.map((fact, index): ProfileReadinessStepV1 => Object.freeze({
      id: fact.id,
      status: fact.complete ? 'complete' : index === firstIncomplete ? (fact.blocked ? 'blocked' : 'current') : 'pending',
      title: fact.title,
      detail: fact.detail,
      reasonCode: fact.complete ? null : fact.reasonCode,
      route: fact.route,
      actionLabel: fact.actionLabel,
    }));
    return Object.freeze({ schemaVersion: 1, profileId,
      stage: firstIncomplete === -1 ? 'ready' : facts[firstIncomplete]!.id,
      portfolioReady, firstDecisionComplete, steps: Object.freeze(steps), asOfMs });
  }
}
