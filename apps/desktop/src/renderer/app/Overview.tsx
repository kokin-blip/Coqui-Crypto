import { useMemo } from 'react';

import type { CoquiClient } from '@coqui/contracts';
import { CHART_COLORS, formatUsd } from '@coqui/ui-kit';

import { FinancialChart } from './FinancialChart.js';
import { NegativeFindings } from './NegativeFindings.js';
import { Scoreboard } from './Scoreboard.js';
import { useChannel } from '../query/use-channel.js';

export function Overview({ client }: { readonly client: CoquiClient }): React.JSX.Element {
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
    values: performance.value.points.map((point) => ({
      day: new Date(point.dayUtc).toISOString().slice(0, 10), value: Number(point.equityUsd),
    })),
  }, {
    id: 'overview-benchmark', label: 'Hold benchmark', color: CHART_COLORS.benchmark,
    values: performance.value.points.filter((point) => point.benchmarkUsd !== null).map((point) => ({
      day: new Date(point.dayUtc).toISOString().slice(0, 10), value: Number(point.benchmarkUsd),
    })),
  }], [performance]);

  const latest = proposals.kind === 'ready' ? proposals.value.proposals[0] : undefined;
  return (
    <div className="screen-stack overview-screen">
      <section className="decision-banner" aria-labelledby="decision-summary-heading">
        <p className="eyebrow">Decision summary</p>
        <h2 id="decision-summary-heading">Research evidence does not permit a paper action</h2>
        <p>The leading strategy remains unvalidated. The complete evidence and risk chain is rerun at submission.</p>
      </section>

      <section className="overview-health" aria-label="Portfolio and operating exposure">
        <article className="overview-number">
          <p className="eyebrow">Actual portfolio</p>
          <strong>{portfolio.kind === 'ready' ? formatUsd(portfolio.value.valuation.totalValueUsd)?.text : 'Unavailable'}</strong>
          <span>{portfolio.kind === 'ready' ? `${portfolio.value.valuation.unpricedCount} unpriced · ${portfolio.value.holdings.length} holdings` : 'Portfolio evidence loading'}</span>
        </article>
        <article className="overview-number">
          <p className="eyebrow">Risk permission</p>
          <strong>{risk.kind === 'ready' ? risk.value.stage.replaceAll('_', ' ').toUpperCase() : 'UNKNOWN'}</strong>
          <span>{risk.kind === 'ready' ? (risk.value.blockReason ?? `Sizing ×${risk.value.exposureScale}`) : 'Risk evidence loading'}</span>
        </article>
        <article className="overview-number">
          <p className="eyebrow">Reconciliation</p>
          <strong>{status.kind === 'ready' && status.value.reconciliation.neverRun
            ? 'NOT RUN'
            : reconciliation.kind === 'ready' && reconciliation.value.unresolvedCount === 0 ? 'SETTLED' : 'REVIEW'}</strong>
          <span>{status.kind === 'ready' && status.value.reconciliation.neverRun
            ? 'No completed reconciliation evidence'
            : reconciliation.kind === 'ready' ? `${reconciliation.value.unresolvedCount} unresolved` : 'State loading'}</span>
        </article>
        <article className="overview-number">
          <p className="eyebrow">Forward evidence</p>
          <strong>{edgeStudy.kind === 'ready' ? `${edgeStudy.value.completedDays} / 365` : 'UNKNOWN'}</strong>
          <span>{campaign.kind === 'ready' && campaign.value !== null ? `campaign ${campaign.value.observedDays}/7 days · ${campaign.value.state}` : 'campaign awaiting first eligible day'}</span>
        </article>
      </section>

      <section className="panel"><Scoreboard client={client} detail="summary" /></section>

      <section className="panel overview-chart" aria-labelledby="overview-equity-heading">
        <div className="panel-heading"><div><p className="eyebrow">Verified paper evidence</p><h2 id="overview-equity-heading">Equity and benchmark preview</h2></div></div>
        {chart[0]?.values.length ? <FinancialChart series={chart} summary="Verified paper equity preview with starting-portfolio hold benchmark where available." /> : <p className="empty-copy">No daily paper valuation history yet. Coqui never reconstructs or decorates missing curves.</p>}
      </section>

      <section className="overview-two-column">
        <div className="panel">
          <p className="eyebrow">Recent decisions</p><h2>Operational activity</h2>
          {activity.kind === 'ready' && activity.value.events.length > 0 ? (
            <ul className="overview-activity">{activity.value.events.map((event) => <li key={event.id}><strong>{event.title}</strong><span>{event.status} · {new Date(event.occurredAt).toISOString().slice(0, 10)}</span></li>)}</ul>
          ) : <p className="empty-copy">No recorded decisions yet.</p>}
        </div>
        <div className="panel">
          <p className="eyebrow">Paper proposal preview</p><h2>{latest === undefined ? 'No proposal pending' : `${latest.actions.length} rebalance action${latest.actions.length === 1 ? '' : 's'}`}</h2>
          <p>{latest === undefined ? 'Prepare a system-generated rebalance in Paper Trading.' : `${latest.status.replaceAll('_', ' ')} · revision ${latest.revision} · ${latest.proposalHash.slice(0, 12)}…`}</p>
        </div>
      </section>

      <NegativeFindings client={client} />
    </div>
  );
}
