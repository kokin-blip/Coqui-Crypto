import { useId, useState } from 'react';
import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';
import { ChannelNotice } from './TerminalPrimitives.js';
import { MetricInfo } from './MetricInfo.js';
import { formatLocalTimestamp } from './time-format.js';

type Report = ChannelResponse<'capital.performance'>;
type Metric = Report['metrics'][keyof Report['metrics']];
type Provider = ChannelResponse<'capital.scopes'>['scopes'][number]['scope']['provider'];
type Options = { readonly provider?: Provider; readonly profileId?: string; readonly connectionId?: string | null;
  readonly enabled?: boolean; readonly selectedScopeId?: string };

export function useCapitalPerformance(client: CoquiClient, options: Options = {}) {
  const catalog = useChannel(client, 'capital.scopes', {}, options.enabled !== false, options.profileId);
  const entries = catalog.kind === 'ready' ? catalog.value.scopes.filter((entry) =>
    (options.provider === undefined || entry.scope.provider === options.provider) &&
    (options.connectionId == null || entry.connectionId === options.connectionId)) : [];
  const active = entries.filter((entry) => entry.mode === 'active');
  const entry = options.selectedScopeId ? entries.find((row) => row.scope.id === options.selectedScopeId) : active.length === 1 ? active[0] : undefined;
  const state = useChannel(client, 'capital.performance', { scopeId: entry?.scope.id ?? '0'.repeat(64),
    epochId: entry?.epochs[0]?.id ?? null, fromMs: null, toMs: null }, options.enabled !== false && entry !== undefined, options.profileId);
  return { catalog, entries, entry, state };
}

export function CapitalMetricValue({ value, label, unit = 'usd' }: {
  readonly value: Metric; readonly label: string; readonly unit?: 'usd' | 'percent' | 'ratio';
}): React.JSX.Element {
  if (value.state === 'unavailable') return <>Unavailable<MetricInfo label={label}>{value.restoration.join(' ')}</MetricInfo></>;
  return <>{unit === 'usd' ? formatUsd(value.value)?.text ?? value.value : unit === 'percent' ? `${value.value}%` : value.value}</>;
}

const METRICS: readonly { key: keyof Report['metrics']; label: string; unit: 'usd' | 'percent' | 'ratio' }[] = [
  { key: 'equityUsd', label: 'Observed account equity', unit: 'usd' },
  { key: 'balanceChangeUsd', label: 'Balance change', unit: 'usd' },
  { key: 'economicPnlUsd', label: 'Economic P&L', unit: 'usd' },
  { key: 'contributionsUsd', label: 'External contributions', unit: 'usd' },
  { key: 'netOutflowsUsd', label: 'Net external outflows', unit: 'usd' },
  { key: 'confirmedUserReceiptsUsd', label: 'Confirmed user receipts', unit: 'usd' },
  { key: 'timeWeightedReturnPct', label: 'Time-weighted return', unit: 'percent' },
  { key: 'annualizedReturnPct', label: 'Annualized return', unit: 'percent' },
  { key: 'moneyWeightedReturnPct', label: 'Money-weighted return (annual IRR)', unit: 'percent' },
  { key: 'maxDrawdownPct', label: 'Maximum daily drawdown', unit: 'percent' },
  { key: 'volatilityPct', label: 'Daily volatility (annualized)', unit: 'percent' },
  { key: 'sharpe', label: 'Sharpe', unit: 'ratio' }, { key: 'sortino', label: 'Sortino', unit: 'ratio' },
  { key: 'calmar', label: 'Calmar', unit: 'ratio' }, { key: 'timeBelowHighPct', label: 'Time below high', unit: 'percent' },
  { key: 'feesUsd', label: 'Attributed account fees', unit: 'usd' }, { key: 'incomeUsd', label: 'Attributed investment income', unit: 'usd' },
  { key: 'realizedPnlUsd', label: 'Account-scoped realized P&L', unit: 'usd' },
  { key: 'unrealizedPnlUsd', label: 'Account-scoped unrealized P&L', unit: 'usd' },
];

export function CapitalPerformancePanel({ client, compact = false, ...options }: Options & {
  readonly client: CoquiClient; readonly compact?: boolean;
}): React.JSX.Element {
  const [selectedScopeId, setSelectedScopeId] = useState('');
  const selectId = useId();
  const { catalog, entries, entry, state } = useCapitalPerformance(client, { ...options,
    ...(selectedScopeId ? { selectedScopeId } : {}) });
  if (catalog.kind !== 'ready') return <ChannelNotice state={catalog} label="Capital accounting" />;
  if (entries.length === 0) return <p className="metric-note" role="status">Capital performance unavailable: no verified account or paper opening is recorded. Existing balances remain visible in the portfolio.</p>;
  const chooser = entries.length > 1 || entry === undefined ? <label htmlFor={selectId}>Performance account
    <select id={selectId} value={entry?.scope.id ?? ''} onChange={(event) => setSelectedScopeId(event.target.value)}>
      <option value="">Choose an account</option>{entries.map((row) => <option key={row.scope.id} value={row.scope.id}>
        {row.label} · {row.mode}{row.latestObservedAtMs === null ? '' : ` · ${formatLocalTimestamp(row.latestObservedAtMs)}`}
      </option>)}
    </select></label> : null;
  if (entry === undefined) return <div>{chooser}<p className="metric-note">Choose one account to inspect its capital and performance evidence.</p></div>;
  if (state.kind !== 'ready') return <div>{chooser}<ChannelNotice state={state} label="Capital performance" /></div>;
  const report = state.value;
  const metrics = compact ? METRICS.filter((metric) => ['economicPnlUsd', 'timeWeightedReturnPct', 'maxDrawdownPct'].includes(metric.key)) : METRICS;
  return <section className={compact ? 'capital-performance' : 'panel capital-performance'} aria-label="Cash-flow-correct performance">
    {!compact && <h2>Account performance</h2>}{chooser}
    <p className="metric-note">{entry.label} · USD · {entry.mode === 'active' ? 'Recorded evidence' : `${entry.mode} evidence`}
      {entry.latestObservedAtMs === null ? '' : ` · Last source read ${formatLocalTimestamp(entry.latestObservedAtMs)}`}</p>
    {entry.mode !== 'active' && <p className="metric-note" role="status">Historical evidence only. This account has no active accounting connection.</p>}
    {report.fromMs === null ? <p className="metric-note">Earlier performance is unavailable until a supported economic opening is recorded.</p> :
      <p className="metric-note">Tracking since {formatLocalTimestamp(report.fromMs)}. Period ends {report.toMs === null ? 'unavailable' : formatLocalTimestamp(report.toMs)}.</p>}
    {entry.coverage?.reasonCodes.includes('capital_ingestion_failed') && <p className="metric-note" role="status">The latest accounting capture failed. These observations retain their original dates; refresh the source to retry.</p>}
    <dl className="metric-grid">{metrics.map(({ key, label, unit }) => <div key={key}><dt>{label}</dt>
      <dd><CapitalMetricValue value={report.metrics[key]} label={label} unit={unit} /></dd></div>)}</dl>
    <p className="metric-note">Balance changes include funding. Economic P&amp;L excludes verified external capital; account costs are counted once. Selling into cash is not a payment to the user.</p>
    <details><summary>Evidence and calculation details</summary>
      <p className="metric-note">Capital accounting v1 · 365-day annualization · 0% risk-free rate. Descriptive statistics do not establish strategy qualification. Earlier history and missing observations are not reconstructed.</p>
      {report.historicalLimitations.length > 0 && <p className="metric-note">Opening limitations: {report.historicalLimitations.map((reason) => reason.replaceAll('_', ' ')).join('; ')}.</p>}
      <p className="metric-note">Input evidence: {report.inputManifest.batchIds.length} source batches, {report.inputManifest.eventIds.length} event revisions and {report.inputManifest.valuationIds.length} valuations.</p>
      <code>{report.inputHash}</code>
      {report.points.length > 0 && <div className="terminal-table-scroll" role="region" aria-label="Recorded account valuations" tabIndex={0}><table><caption>Latest recorded valuations; missing NAV stays unavailable</caption>
        <thead><tr><th scope="col">Actual valuation time</th><th scope="col">Observed equity</th><th scope="col">Unit NAV</th></tr></thead>
        <tbody>{report.points.slice(-30).map((point) => <tr key={point.valuationId}><td>{formatLocalTimestamp(point.atMs)}</td>
          <td>{point.equityUsd === null ? 'Unavailable' : formatUsd(point.equityUsd)?.text}</td><td>{point.unitNavUsd ?? 'Unavailable'}</td></tr>)}</tbody>
      </table></div>}
    </details>
  </section>;
}
