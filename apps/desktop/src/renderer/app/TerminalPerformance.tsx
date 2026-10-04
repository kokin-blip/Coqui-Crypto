import { lazy, Suspense, useMemo, useState } from 'react';
import type { CoquiClient } from '@coqui/contracts';
import { CHART_COLORS, formatUsd } from '@coqui/ui-kit';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice, TerminalMetric } from './TerminalPrimitives.js';
import { FinancialChart } from './FinancialChart.js';

const LedgerPerformance = lazy(async () => ({ default: (await import('./Performance.js')).Performance }));

function ExploratoryPerformance({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const portfolio = useChannel(client, 'paper.exploratory.portfolio', {});
  const performance = useChannel(client, 'paper.exploratory.performance', {});
  const points = useMemo(() => {
    if (performance.kind !== 'ready') return [];
    const daily = new Map<string, typeof performance.value.points[number]>();
    for (const point of performance.value.points) {
      const day = new Date(point.asOfMs).toISOString().slice(0, 10);
      if (point.asOfMs >= (daily.get(day)?.asOfMs ?? 0)) daily.set(day, point);
    }
    return [...daily].sort(([a], [b]) => a.localeCompare(b));
  }, [performance]);
  const series = [
    { id: 'equity', label: 'Exploratory equity after estimated costs', color: CHART_COLORS.primary,
      values: points.filter(([, p]) => p.equityUsd !== null).map(([day, p]) => ({ day, value: Number(p.equityUsd) })) },
    { id: 'benchmark', label: 'Opening portfolio buy-and-hold', color: CHART_COLORS.benchmark,
      values: points.filter(([, p]) => p.buyAndHoldBenchmarkUsd !== null).map(([day, p]) => ({ day, value: Number(p.buyAndHoldBenchmarkUsd) })) },
  ];
  const current = portfolio.kind === 'ready' ? portfolio.value : null;
  const percent = (value: number | null | undefined): string => value === null || value === undefined ? 'Unavailable' : `${value.toFixed(2)}%`;
  return <div className="terminal-performance"><ChannelNotice state={portfolio} label="Exploratory portfolio" /><ChannelNotice state={performance} label="Exploratory performance" />
    <dl className="terminal-performance-metrics"><TerminalMetric label="Paper return">{percent(current?.paperReturnPct)}</TerminalMetric>
      <TerminalMetric label="Vs. buy-and-hold">{percent(current?.benchmarkDifferencePct)}</TerminalMetric>
      <TerminalMetric label="Drawdown">{percent(current?.drawdownPct)}</TerminalMetric>
      <TerminalMetric label="Estimated costs">{current === null ? 'Unavailable' : formatUsd(current.estimatedCostsUsd)?.text}</TerminalMetric></dl>
    {current !== null && current.valuationStatus !== 'complete' && <p className="terminal-state-note">Valuation {current.valuationStatus} · incomplete observations are excluded from plotted values.</p>}
    {performance.kind === 'ready' && performance.value.points.some((p) => p.unpricedCount > 0 || p.equityUsd === null) && <p className="terminal-state-note">Some historical valuations are incomplete; unpriced values remain unavailable.</p>}
    {performance.kind === 'ready' && (series[0]!.values.length === 0 ? <p className="terminal-empty">No valued exploratory observations recorded.</p>
      : <FinancialChart client={client} series={series} summary="Exploratory simulation equity after estimated costs against the opening portfolio buy-and-hold benchmark. Latest recorded observation per UTC day." />)}
    <p className="terminal-footnote">Exploratory simulation · not validation or promotion evidence · latest observation per UTC day · estimated costs, not exchange execution fees</p>
  </div>;
}

export function TerminalPerformance({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const portfolio = useChannel(client, 'paper.exploratory.portfolio', {});
  const [source, setSource] = useState('current');
  const exploratory = source === 'exploratory' || source === 'current' && portfolio.kind === 'ready' && portfolio.value?.primary === true;
  return <><div className="terminal-table-toolbar"><label>Simulation<select value={source} onChange={(event) => setSource(event.target.value)}><option value="current">Current paper campaign</option><option value="ledger">Paper ledger</option><option value="exploratory">Exploratory campaign</option></select></label><span>{exploratory ? 'Exploratory / unvalidated' : 'Paper ledger'} · after costs</span></div>
    {source === 'current' && portfolio.kind !== 'ready' ? <ChannelNotice state={portfolio} label="Paper campaign" /> : exploratory ? <ExploratoryPerformance client={client} />
      : <Suspense fallback={<p className="terminal-empty">Loading performance…</p>}><LedgerPerformance client={client} /></Suspense>}</>;
}
