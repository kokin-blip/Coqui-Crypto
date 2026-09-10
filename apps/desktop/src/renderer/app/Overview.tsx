import type { CoquiClient } from '@coqui/contracts';
import { formatUsd, InteractivePanel } from '@coqui/ui-kit';

import { AllocationRing } from './AllocationRing.js';
import { EvidenceStack } from './EvidenceStack.js';
import { HeldCoinPerformance } from './HeldCoinPerformance.js';
import { NegativeFindings } from './NegativeFindings.js';
import { AdvancedStrategyComparison, OverviewStrategyProvider, StrategyDetail } from './OverviewStrategyWorkspace.js';
import { Scoreboard } from './Scoreboard.js';
import { useWorkspace } from './WorkspaceContext.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';
import { useChannel } from '../query/use-channel.js';

export function Overview({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const workspace = useWorkspace();
  const portfolio = useChannel(client, 'portfolio.current', {});
  const risk = useChannel(client, 'risk.dashboard', {});
  const reconciliation = useChannel(client, 'portfolio.reconciliation', {});
  const status = useChannel(client, 'app.status-rail', {});
  const activity = useChannel(client, 'activity.feed', { limit: 4, cursor: null });
  const proposals = useChannel(client, 'paper.execution.proposals', { limit: 1 });
  const edgeStudy = useChannel(client, 'research.edge-study', {});
  const campaign = useChannel(client, 'paper.campaign', {});
  const preferences = workspace.preferences;
  const rawAllocation = portfolio.kind !== 'ready' || portfolio.value === null ? [] : portfolio.value.exposures
    .flatMap((holding) => holding.valueUsd === null ? [] : [{ id: holding.exposureKey, label: holding.exposureKey, valueUsd: holding.valueUsd }])
    .sort((a, b) => Number(b.valueUsd) - Number(a.valueUsd));
  const allocation = rawAllocation.length <= 8 ? rawAllocation : [...rawAllocation.slice(0, 8), {
    id: 'other', label: `Other (${rawAllocation.length - 8})`,
    valueUsd: rawAllocation.slice(8).reduce((sum, item) => sum + Number(item.valueUsd), 0).toString(),
  }];
  const latest = proposals.kind === 'ready' ? proposals.value.proposals[0] : undefined;

  const decision = <section className="decision-banner overview-decision" aria-labelledby="decision-summary-heading"><p className="eyebrow">Decision summary</p><h2 id="decision-summary-heading">Research evidence does not permit a paper action</h2><p>The leading strategy remains unvalidated. The complete evidence and risk chain is rerun at submission.</p></section>;
  const health = <section className="overview-health" aria-label="Portfolio and operating exposure">
    <article className="overview-number"><p className="eyebrow">Connected portfolio</p><strong>{portfolio.kind === 'ready' && portfolio.value !== null && portfolio.value.totalValueUsd !== null ? formatUsd(portfolio.value.totalValueUsd)?.text : 'Unavailable'}</strong><span>{portfolio.kind === 'ready' && portfolio.value !== null ? `${portfolio.value.exposures.length} exposures · ${portfolio.value.complete ? 'complete valuation' : 'valuation incomplete'}` : 'Sync Coinbase or Robinhood to populate'}</span></article>
    <article className="overview-number"><p className="eyebrow">Risk permission</p><strong>{risk.kind === 'ready' ? risk.value.stage.replaceAll('_', ' ').toUpperCase() : 'UNKNOWN'}</strong><span>{risk.kind === 'ready' ? (risk.value.blockReason ?? `Sizing ×${risk.value.exposureScale}`) : 'Risk evidence loading'}</span></article>
    <article className="overview-number"><p className="eyebrow">Reconciliation</p><strong>{status.kind === 'ready' && status.value.reconciliation.neverRun ? 'NOT RUN' : reconciliation.kind === 'ready' && reconciliation.value.unresolvedCount === 0 ? 'SETTLED' : 'REVIEW'}</strong><span>{status.kind === 'ready' && status.value.reconciliation.neverRun ? 'No completed reconciliation evidence' : reconciliation.kind === 'ready' ? `${reconciliation.value.unresolvedCount} unresolved` : 'State loading'}</span></article>
    <article className="overview-number"><p className="eyebrow">Forward evidence</p><strong>{edgeStudy.kind === 'ready' ? `${edgeStudy.value.completedDays} / 365` : 'UNKNOWN'}</strong><span>{campaign.kind === 'ready' && campaign.value !== null ? `campaign ${campaign.value.observedDays}/7 days · ${campaign.value.state}` : 'campaign awaiting first eligible day'}</span></article>
  </section>;
  const chartPanel = <section className="overview-portfolio-grid" aria-label="Connected portfolio overview"><article className="panel overview-allocation"><div className="panel-heading"><div><p className="eyebrow">Current connected balances</p><h2>Allocation</h2></div></div><AllocationRing data={allocation} /></article><article className="panel overview-chart" aria-labelledby="held-performance-heading"><div className="panel-heading"><div><p className="eyebrow">Held assets</p><h2 id="held-performance-heading">One-year relative performance</h2></div></div><HeldCoinPerformance client={client} exposures={portfolio.kind === 'ready' && portfolio.value !== null ? portfolio.value.exposures : []} /></article></section>;
  const recent = <section className="panel overview-recent"><header className="compact-panel-heading"><div><p className="eyebrow">Recent decisions</p><h2>Operational activity</h2></div></header><div className="compact-panel-body">{activity.kind === 'ready' && activity.value.events.length > 0 ? <ul className="overview-activity">{activity.value.events.map((event) => <li key={event.id}><strong>{event.title}</strong><time dateTime={exactUtcTimestamp(event.occurredAt)} title={exactUtcTimestamp(event.occurredAt)}>{event.status} · {formatLocalTimestamp(event.occurredAt)}</time></li>)}</ul> : <div className="panel-empty-body"><p>No recorded decisions yet.</p></div>}</div></section>;
  const proposal = <InteractivePanel className="panel overview-proposal"><header className="compact-panel-heading"><div><p className="eyebrow">Paper proposal</p><h2>Action preview</h2></div></header><div className="compact-panel-body"><strong>{latest === undefined ? 'No proposal pending' : `${latest.actions.length} rebalance action${latest.actions.length === 1 ? '' : 's'}`}</strong><p>{latest === undefined ? 'Prepare a system-generated rebalance in Paper Trading.' : `${latest.status.replaceAll('_', ' ')} · revision ${latest.revision} · ${latest.proposalHash.slice(0, 12)}…`}</p></div></InteractivePanel>;

  if (workspace.mode === 'simple') return <div className="screen-stack overview-screen">{health}{chartPanel}{decision}<details className="simple-disclosure"><summary>Show strategy, activity, and negative evidence</summary><div className="simple-disclosure-content"><section className="panel"><Scoreboard client={client} detail="summary" /></section><section className="overview-two-column">{recent}{proposal}</section><div><NegativeFindings client={client} /></div></div></details></div>;

  const panels = preferences?.advancedOverviewPanels ?? { strategyDetail: true, strategyComparison: true, recentActivity: true, proposalPreview: true, healthStrip: true, negativeFindings: true };
  return <OverviewStrategyProvider client={client}><div className={`screen-stack overview-screen research-grid preset-${preferences?.advancedOverviewPreset ?? 'research_grid'}`}>
    {panels.healthStrip && health}
    <div className="research-grid-primary">{chartPanel}<EvidenceStack client={client} />{panels.strategyDetail && <StrategyDetail />}</div>
    <div className="research-grid-secondary">{panels.strategyComparison && <AdvancedStrategyComparison />}<div className="research-grid-side">{panels.recentActivity && recent}{panels.proposalPreview && proposal}</div></div>
    {panels.negativeFindings && <div className="overview-negative"><NegativeFindings client={client} /></div>}
  </div></OverviewStrategyProvider>;
}
