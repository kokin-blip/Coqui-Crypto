import { useMemo, useState } from 'react';

import type { CoquiClient } from '@coqui/contracts';
import { CHART_COLORS, formatPercent, formatUsd } from '@coqui/ui-kit';

import { FinancialChart } from './FinancialChart.js';
import { ChartRangeControl, filterPointsByRange } from './ChartRangeControl.js';
import { ChartViewControl } from './ChartViewControl.js';
import { PerformanceDayDrawer } from './PerformanceDayDrawer.js';
import { useWorkspace } from './WorkspaceContext.js';
import { useChannel } from '../query/use-channel.js';

function metric(value: string | null, suffix = ''): string {
  return value === null ? 'Unavailable' : `${value}${suffix}`;
}

const PERFORMANCE_VIEWS = [
  { value: 'equity', label: 'Equity' },
  { value: 'drawdown', label: 'Drawdown' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'distribution', label: 'Distribution' },
] as const;

function EmptyPerformance(): React.JSX.Element {
  return (
    <div className="screen-stack performance-screen performance-empty-workspace">
      <section className="panel chart-panel" aria-labelledby="performance-empty-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">Daily immutable evidence</p><h2 id="performance-empty-heading">Equity and benchmark</h2></div>
          <ChartRangeControl surface="performance" />
        </div>
        <div className="chart-empty-canvas" role="img" aria-label="No verified paper performance observations are available.">
          <strong>No verified daily paper history yet</strong>
          <span>Coqui records a valuation only after a scheduled decision. Missing days are never fabricated or backfilled.</span>
        </div>
      </section>
      <section className="panel" aria-labelledby="performance-empty-metrics">
        <div className="panel-heading"><div><p className="eyebrow">Verified observations only</p><h2 id="performance-empty-metrics">Risk and return metrics</h2></div></div>
        <dl className="metric-grid metric-grid-unavailable">
          {['Annualized return', 'Volatility', 'Sharpe', 'Sortino', 'Calmar', 'Max drawdown', 'Win rate', 'Profit factor', 'Turnover', 'Time below high'].map((label) => (
            <div key={label}><dt>{label}</dt><dd>—</dd></div>
          ))}
        </dl>
        <p className="metric-note">Metrics remain unavailable until immutable daily valuations provide sufficient evidence.</p>
      </section>
      <section className="performance-lower-grid" aria-label="Unavailable performance evidence">
        {['P&L calendar', 'Drawdown history', 'Recorded costs'].map((label) => (
          <article className="panel performance-unavailable-panel" key={label}><h2>{label}</h2><p>Unavailable until verified observations exist.</p></article>
        ))}
      </section>
    </div>
  );
}

export function Performance({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const performance = useChannel(client, 'paper.performance', {});
  const workspace = useWorkspace();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const range = workspace.preferences?.chartRanges.performance ?? '1y';
  const selectedView = workspace.preferences?.performanceChart ?? 'equity';
  const visiblePoints = useMemo(() => performance.kind !== 'ready' ? [] : filterPointsByRange(
    performance.value.points.map((point) => ({ ...point, day: new Date(point.dayUtc).toISOString().slice(0, 10) })),
    range,
  ), [performance, range]);
  const chartSeries = useMemo(() => performance.kind !== 'ready' ? [] : [
    {
      id: 'equity', label: 'Paper equity', color: CHART_COLORS.primary,
      values: visiblePoints.map((point) => ({
        day: point.day, value: Number(point.equityUsd),
      })),
    },
    {
      id: 'benchmark', label: 'Starting-portfolio hold benchmark', color: CHART_COLORS.benchmark,
      values: visiblePoints.filter((point) => point.benchmarkUsd !== null).map((point) => ({
        day: point.day, value: Number(point.benchmarkUsd),
      })),
    },
  ], [performance.kind, visiblePoints]);

  if (performance.kind === 'loading') return <p aria-live="polite">Loading performance evidence…</p>;
  if (performance.kind !== 'ready') {
    return <p role="alert">Could not load performance: {performance.issues.map((issue) => issue.code).join(', ')}</p>;
  }
  const view = performance.value;
  if (view.points.length === 0) return <EmptyPerformance />;

  const drawdownSeries = [{
    id: 'drawdown', label: 'Drawdown', color: CHART_COLORS.negative,
    values: visiblePoints.map((point) => ({
      day: point.day, value: Number(point.drawdownPct),
    })),
  }];
  return (
    <div className="screen-stack performance-screen">
      <div className="performance-command-row">
        <ChartViewControl
          ariaLabel="Performance view"
          value={selectedView}
          options={PERFORMANCE_VIEWS}
          disabled={workspace.pending}
          onChange={(performanceChart) => void workspace.update({ performanceChart })}
        />
        <ChartRangeControl surface="performance" />
      </div>
      <section className="panel chart-panel" aria-labelledby="equity-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">Daily immutable evidence</p><h2 id="equity-heading">Equity and benchmark</h2></div>
        </div>
        {selectedView === 'drawdown' ? (
          <FinancialChart series={drawdownSeries} summary={`Worst verified drawdown ${view.metrics.maxDrawdownPct} percent.`} />
        ) : (
          <FinancialChart
            series={chartSeries}
            summary={`${visiblePoints.length} verified paper equity observations in the selected range. Benchmark ${view.benchmarkStatus === 'available' ? 'available' : 'unavailable because starting evidence is missing'}.`}
          />
        )}
        {view.benchmarkStatus !== 'available' && (
          <p className="metric-note">Benchmark unavailable: no immutable starting-portfolio evidence exists. Coqui will not reconstruct it.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="metrics-heading">
        <div className="panel-heading"><div><p className="eyebrow">365-day crypto annualization</p><h2 id="metrics-heading">Risk and return metrics</h2></div></div>
        <dl className="metric-grid">
          <div><dt>Annualized return</dt><dd>{metric(view.metrics.annualizedReturnPct, '%')}</dd></div>
          <div><dt>Volatility</dt><dd>{metric(view.metrics.volatilityPct, '%')}</dd></div>
          <div><dt>Sharpe</dt><dd>{metric(view.metrics.sharpe)}</dd></div>
          <div><dt>Sortino</dt><dd>{metric(view.metrics.sortino)}</dd></div>
          <div><dt>Calmar</dt><dd>{metric(view.metrics.calmar)}</dd></div>
          <div><dt>Max drawdown</dt><dd>{view.metrics.maxDrawdownPct}%</dd></div>
          <div><dt>Win rate</dt><dd>{metric(view.metrics.winRatePct, '%')}</dd></div>
          <div><dt>Profit factor</dt><dd>{metric(view.metrics.profitFactor)}</dd></div>
          <div><dt>Turnover</dt><dd>{metric(view.metrics.turnoverPct, '%')}</dd></div>
          <div><dt>Time below high</dt><dd>{view.metrics.timeBelowHighPct}%</dd></div>
        </dl>
        <p className="metric-note">Sharpe and Sortino assume a displayed 0% risk-free rate. Figures exclude incomplete valuations and unattributed opening balances where cost basis is required.</p>
      </section>

      <section className={`panel ${selectedView === 'calendar' ? 'performance-focus-panel' : ''}`} aria-labelledby="calendar-heading">
        <div className="panel-heading"><div><p className="eyebrow">Select a day for provenance</p><h2 id="calendar-heading">P&amp;L calendar</h2></div></div>
        <div className="pnl-calendar">
          {view.points.map((point) => (
            <button key={point.dayUtc} aria-expanded={selectedDay === point.dayUtc} onClick={() => setSelectedDay(point.dayUtc)}>
              <time>{new Date(point.dayUtc).toISOString().slice(5, 10)}</time>
              <strong>{point.pnlUsd === null ? 'Opening' : formatUsd(point.pnlUsd, { signed: true })?.text}</strong>
              <span>{point.returnPct === null ? '—' : formatPercent(Number(point.returnPct))?.text}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={`panel ${selectedView === 'drawdown' ? 'performance-focus-panel' : ''}`} aria-labelledby="drawdown-heading">
        <div className="panel-heading"><div><p className="eyebrow">Distance from prior high</p><h2 id="drawdown-heading">Drawdown history</h2></div></div>
        <FinancialChart series={drawdownSeries} summary={`Worst verified drawdown ${view.metrics.maxDrawdownPct} percent.`} />
        <div className="drawdown-cards">
          {view.worstDrawdowns.map((episode, index) => (
            <article key={`${episode.peakDayUtc}:${episode.troughDayUtc}`}>
              <span>#{index + 1} · {episode.recoveredDayUtc === null ? 'UNRECOVERED' : 'RECOVERED'}</span>
              <strong>{episode.drawdownPct}%</strong>
              <small>{episode.declineDays}d decline · {episode.recoveryDays === null ? 'recovery pending' : `${episode.recoveryDays}d recovery`}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="performance-lower-grid">
        <div className={`panel ${selectedView === 'distribution' ? 'performance-focus-panel' : ''}`}>
          <p className="eyebrow">Seasonality</p><h2>Monthly P&amp;L</h2>
          <ul className="monthly-list">{view.monthlyPnl.map((month) => <li key={month.month}><span>{month.month}</span><strong>{formatUsd(month.pnlUsd, { signed: true })?.text}</strong></li>)}</ul>
        </div>
        <div className="panel">
          <p className="eyebrow">Observed daily results</p><h2>Return distribution</h2>
          <ul className="distribution-list">{view.distribution.map((bucket) => <li key={bucket.bucket}><span>{bucket.bucket}</span><i style={{ inlineSize: `${Math.min(100, bucket.count * 10)}%` }} /><strong>{bucket.count}</strong></li>)}</ul>
        </div>
        <div className="panel">
          <p className="eyebrow">Execution friction</p><h2>Recorded costs</h2>
          <dl className="cost-list">
            <div><dt>Venue fees</dt><dd>{formatUsd(view.metrics.venueFeesUsd)?.text}</dd></div>
            <div><dt>Spread</dt><dd>{formatUsd(view.metrics.spreadUsd)?.text}</dd></div>
            <div><dt>Slippage</dt><dd>{formatUsd(view.metrics.slippageUsd)?.text}</dd></div>
            <div><dt>Impact</dt><dd>{formatUsd(view.metrics.impactUsd)?.text}</dd></div>
          </dl>
        </div>
      </section>

      <p className="metric-note exclusions-note">
        Excluded: {view.exclusions.incompleteValuationDays} incomplete valuation day(s), {view.exclusions.missingCalendarDays} missing day(s)
        {view.exclusions.unattributedOpeningBalanceExcluded ? ', and sells against unattributed opening balances' : ''}.
      </p>
      {selectedDay !== null && <PerformanceDayDrawer client={client} dayUtc={selectedDay} onClose={() => setSelectedDay(null)} />}
    </div>
  );
}
