import { useMemo } from 'react';
import type { CoquiClient } from '@coqui/contracts';
import { CHART_COLORS, formatUsd, InteractivePanel } from '@coqui/ui-kit';

import { AllocationRing } from './AllocationRing.js';
import { ChartRangeControl, filterPointsByRange } from './ChartRangeControl.js';
import { ChartViewControl } from './ChartViewControl.js';
import { EvidenceStack } from './EvidenceStack.js';
import { FinancialChart } from './FinancialChart.js';
import { NegativeFindings } from './NegativeFindings.js';
import { AdvancedStrategyComparison, OverviewStrategyProvider, StrategyDetail } from './OverviewStrategyWorkspace.js';
import { Scoreboard } from './Scoreboard.js';
import { useWorkspace } from './WorkspaceContext.js';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';

const OVERVIEW_VIEWS = [{ value: 'equity', label: 'Equity' }, { value: 'allocation', label: 'Allocation' }] as const;
const WORKSPACE_INVALIDATIONS = ['accounts.workspace', 'accounts.settings'] as const;

export function Overview({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const workspace = useWorkspace();
  const command = useCommand(client, 'accounts.workspace.set', WORKSPACE_INVALIDATIONS);
  const portfolio = useChannel(client, 'portfolio.view', {});
  const risk = useChannel(client, 'risk.dashboard', {});
  const reconciliation = useChannel(client, 'portfolio.reconciliation', {});
  const status = useChannel(client, 'app.status-rail', {});
  const activity = useChannel(client, 'activity.feed', { limit: 4, cursor: null });
  const proposals = useChannel(client, 'paper.execution.proposals', { limit: 1 });
  const performance = useChannel(client, 'paper.performance', {});
  const edgeStudy = useChannel(client, 'research.edge-study', {});
  const campaign = useChannel(client, 'paper.campaign', {});
  const chart = useMemo(() => performance.kind !== 'ready' ? [] : [{
    id: 'overview-equity', label: 'Paper equity', color: CHART_COLORS.primary,
    values: performance.value.points.map((point) => ({ day: new Date(point.dayUtc).toISOString().slice(0, 10), value: Number(point.equityUsd) })),
  }, {
    id: 'overview-benchmark', label: 'Hold benchmark', color: CHART_COLORS.benchmark,
    values: performance.value.points.filter((point) => point.benchmarkUsd !== null).map((point) => ({ day: new Date(point.dayUtc).toISOString().slice(0, 10), value: Number(point.benchmarkUsd) })),
  }], [performance]);

  const preferences = workspace.preferences;
  const overviewChart = preferences?.overviewChart ?? 'equity';
  const range = preferences?.chartRanges.overview ?? '1y';
  const series = chart.filter((item) => (preferences?.overviewBenchmarkVisible ?? true) || item.id !== 'overview-benchmark').map((item) => ({ ...item, values: filterPointsByRange(item.values, range) }));
  const allocation = portfolio.kind !== 'ready' ? [] : portfolio.value.holdings.flatMap((holding) => holding.valueUsd === null ? [] : [{ id: holding.asset.symbol, label: holding.asset.symbol, valueUsd: holding.valueUsd }]);
  const latest = proposals.kind === 'ready' ? proposals.value.proposals[0] : undefined;

  const decision = <section className="decision-banner overview-decision" aria-labelledby="decision-summary-heading"><p className="eyebrow">Decision summary</p><h2 id="decision-summary-heading">Research evidence does not permit a paper action</h2><p>The leading strategy remains unvalidated. The complete evidence and risk chain is rerun at submission.</p></section>;
  const health = <section className="overview-health" aria-label="Portfolio and operating exposure">
    <article className="overview-number"><p className="eyebrow">Actual portfolio</p><strong>{portfolio.kind === 'ready' ? formatUsd(portfolio.value.valuation.totalValueUsd)?.text : 'Unavailable'}</strong><span>{portfolio.kind === 'ready' ? `${portfolio.value.valuation.unpricedCount} unpriced · ${portfolio.value.holdings.length} holdings` : 'Portfolio evidence loading'}</span></article>
    <article className="overview-number"><p className="eyebrow">Risk permission</p><strong>{risk.kind === 'ready' ? risk.value.stage.replaceAll('_', ' ').toUpperCase() : 'UNKNOWN'}</strong><span>{risk.kind === 'ready' ? (risk.value.blockReason ?? `Sizing ×${risk.value.exposureScale}`) : 'Risk evidence loading'}</span></article>
    <article className="overview-number"><p className="eyebrow">Reconciliation</p><strong>{status.kind === 'ready' && status.value.reconciliation.neverRun ? 'NOT RUN' : reconciliation.kind === 'ready' && reconciliation.value.unresolvedCount === 0 ? 'SETTLED' : 'REVIEW'}</strong><span>{status.kind === 'ready' && status.value.reconciliation.neverRun ? 'No completed reconciliation evidence' : reconciliation.kind === 'ready' ? `${reconciliation.value.unresolvedCount} unresolved` : 'State loading'}</span></article>
    <article className="overview-number"><p className="eyebrow">Forward evidence</p><strong>{edgeStudy.kind === 'ready' ? `${edgeStudy.value.completedDays} / 365` : 'UNKNOWN'}</strong><span>{campaign.kind === 'ready' && campaign.value !== null ? `campaign ${campaign.value.observedDays}/7 days · ${campaign.value.state}` : 'campaign awaiting first eligible day'}</span></article>
  </section>;
  const chartPanel = <section className="panel overview-chart" aria-labelledby="overview-equity-heading"><div className="panel-heading"><div><p className="eyebrow">Verified paper evidence</p><h2 id="overview-equity-heading">{overviewChart === 'equity' ? 'Equity and benchmark' : 'Current allocation'}</h2></div><div className="chart-toolbar"><ChartViewControl ariaLabel="Overview chart view" disabled={command.state.kind === 'pending'} value={overviewChart} options={OVERVIEW_VIEWS} onChange={(value) => void command.run({ commandId: crypto.randomUUID(), patch: { overviewChart: value } })} />{overviewChart === 'equity' && <ChartRangeControl surface="overview" />}</div></div>{overviewChart === 'allocation' ? <AllocationRing data={allocation} /> : series[0]?.values.length ? <FinancialChart client={client} filenameStem="coqui-overview-equity" series={series} style={preferences?.overviewSeriesStyle ?? 'area'} summary="Verified paper equity with starting-portfolio hold benchmark where available." /> : <div className="chart-empty-canvas"><strong>No verified equity history in this range</strong><span>Coqui records a point only after a scheduled decision. Missing curves are never reconstructed or decorated.</span></div>}</section>;
  const recent = <section className="panel overview-recent"><p className="eyebrow">Recent decisions</p><h2>Operational activity</h2>{activity.kind === 'ready' && activity.value.events.length > 0 ? <ul className="overview-activity">{activity.value.events.map((event) => <li key={event.id}><strong>{event.title}</strong><span>{event.status} · {new Date(event.occurredAt).toISOString().slice(0, 10)}</span></li>)}</ul> : <p className="empty-copy">No recorded decisions yet.</p>}</section>;
  const proposal = <InteractivePanel className="panel overview-proposal"><p className="eyebrow">Paper proposal preview</p><h2>{latest === undefined ? 'No proposal pending' : `${latest.actions.length} rebalance action${latest.actions.length === 1 ? '' : 's'}`}</h2><p>{latest === undefined ? 'Prepare a system-generated rebalance in Paper Trading.' : `${latest.status.replaceAll('_', ' ')} · revision ${latest.revision} · ${latest.proposalHash.slice(0, 12)}…`}</p></InteractivePanel>;

  if (workspace.mode === 'simple') return <div className="screen-stack overview-screen">{decision}{health}{chartPanel}<details className="simple-disclosure"><summary>Show strategy, activity, and negative evidence</summary><div className="simple-disclosure-content"><section className="panel"><Scoreboard client={client} detail="summary" /></section><section className="overview-two-column">{recent}{proposal}</section><div><NegativeFindings client={client} /></div></div></details></div>;

  const panels = preferences?.advancedOverviewPanels ?? { strategyDetail: true, strategyComparison: true, recentActivity: true, proposalPreview: true, healthStrip: true, negativeFindings: true };
  return <OverviewStrategyProvider client={client}><div className={`screen-stack overview-screen research-grid preset-${preferences?.advancedOverviewPreset ?? 'research_grid'}`}>
    <div className="research-grid-primary">{chartPanel}<EvidenceStack client={client} />{panels.strategyDetail && <StrategyDetail />}</div>
    <div className="research-grid-secondary">{panels.strategyComparison && <AdvancedStrategyComparison />}<div className="research-grid-side">{panels.recentActivity && recent}{panels.proposalPreview && proposal}</div></div>
    {panels.healthStrip && health}
    {panels.negativeFindings && <div className="overview-negative"><NegativeFindings client={client} /></div>}
  </div></OverviewStrategyProvider>;
}
