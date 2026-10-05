import { CurrentlyWatching, SharedEvaluations, type TerminalActivityState } from './TerminalActivity.js';
import { useRef } from 'react';
import { X } from 'lucide-react';
import type { CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';
import { useChannel } from '../query/use-channel.js';
import { ChannelNotice, TerminalMetric } from './TerminalPrimitives.js';
import { formatLocalTimestamp } from './time-format.js';
import { useDialogFocus } from './use-dialog-focus.js';

function Decision({ client, id, asset }: { readonly client: CoquiClient; readonly id: string; readonly asset: string }): React.JSX.Element {
  const state = useChannel(client, 'decision.detail', { decisionId: id });
  if (state.kind !== 'ready') return <><ChannelNotice state={state} label="Recorded decision" /></>;
  const { decision, events } = state.value;
  const latest = [...events].sort((a, b) => b.event.sequence - a.event.sequence)[0]?.event;
  const reason = latest !== undefined && 'reasonCode' in latest.detail ? latest.detail.reasonCode : null;
  const fact = decision.facts?.momentum.find((item) => item.assetId === asset);
  return <><dl>
    <TerminalMetric label="Strategy">{decision.strategy.id} · {decision.strategy.version}</TerminalMetric>
    <TerminalMetric label="Evaluated">{formatLocalTimestamp(decision.createdAtMs)}</TerminalMetric>
    <TerminalMetric label="Recorded intent" tone={latest?.kind === 'stand_down' || latest?.kind === 'no_trade' ? 'terminal-warning' : ''}>{latest?.kind.replaceAll('_', ' ') ?? 'Evaluation recorded'}</TerminalMetric>
    {reason !== null && <TerminalMetric label="Reason" tone="terminal-warning">{reason.replaceAll('_', ' ')}</TerminalMetric>}
    <TerminalMetric label="Target cash">{decision.cashWeight === null ? 'Unavailable' : `${(decision.cashWeight * 100).toFixed(2)}%`}</TerminalMetric>
    <TerminalMetric label={`${asset} momentum`}>{fact === undefined ? 'Unavailable' : `${fact.returnPct.toFixed(2)}%`}</TerminalMetric>
    <TerminalMetric label="Realized volatility">{decision.facts?.realizedVolPct === null || decision.facts === null ? 'Unavailable' : `${decision.facts.realizedVolPct.toFixed(2)}%`}</TerminalMetric>
    <TerminalMetric label="Below trend">{decision.facts?.belowTrend === null || decision.facts === null ? 'Unavailable' : decision.facts.belowTrend ? 'Yes' : 'No'}</TerminalMetric>
    <TerminalMetric label="Decision history">{decision.historyStatus}</TerminalMetric>
  </dl><details className="terminal-decision-detail"><summary>Targets & recorded evidence</summary><ul>{decision.targets.map((target) => <li key={target.assetId}>{target.assetId} · {(target.weight * 100).toFixed(2)}%</li>)}</ul><small>Decision {decision.decisionId}<br />Market as of {decision.market.asOfMs === null ? 'Unavailable' : formatLocalTimestamp(decision.market.asOfMs)} · {decision.market.freshness}</small></details></>;
}

export function TerminalAlgorithm({ client, productId, activity }: { readonly client: CoquiClient; readonly productId: string; readonly activity?: TerminalActivityState | undefined }): React.JSX.Element {
  const asset = productId.split('-')[0]!;
  const timeline = useChannel(client, 'decision.timeline', { assetScope: asset, asOfMs: null, limit: 1 }, activity === undefined);
  const risk = useChannel(client, 'risk.dashboard', {});
  const gate = useChannel(client, 'risk.evidence-gate', {});
  const portfolio = useChannel(client, 'portfolio.current', {});
  const paper = useChannel(client, 'paper.portfolio', {});
  const exploratory = useChannel(client, 'paper.exploratory.portfolio', {});
  const performance = useChannel(client, 'paper.performance', {});
  const latestId = timeline.kind === 'ready' ? timeline.value.items[0]?.decisionId : undefined;
  const primary = exploratory.kind === 'ready' && exploratory.value?.primary === true ? exploratory.value : null;
  const money = (v: string | null | undefined): string => v === null || v === undefined ? 'Unavailable' : formatUsd(v)?.text ?? v;
  return <div className="terminal-algorithm-content">
    <section className="terminal-panel"><header>Currently Watching <span className="terminal-secondary">{asset} / recorded evidence</span></header>
      {primary !== null && <dl><TerminalMetric label="Primary simulation">{primary.campaign.strategyId}</TerminalMetric><TerminalMetric label="Campaign status">{primary.status} · exploratory / unvalidated</TerminalMetric><TerminalMetric label="Valuation">{primary.valuationStatus}</TerminalMetric></dl>}
      {activity !== undefined ? <><CurrentlyWatching state={activity.summary} /><SharedEvaluations client={client} productId={productId} enabled={activity.shared} /></> : <>
      <ChannelNotice state={timeline} label="Decision timeline" />
      {latestId !== undefined ? <Decision key={latestId} client={client} id={latestId} asset={asset} /> : timeline.kind === 'ready' && <p className="terminal-empty">No recorded evaluation for {asset}.</p>}</>}
    </section>
    <section className="terminal-panel"><header>Evidence & Risk <a href="#/risk">Inspect →</a></header>
      <ChannelNotice state={risk} label="Risk" /><ChannelNotice state={gate} label="Evidence gate" />
      <dl><TerminalMetric label="Assessment">{risk.kind === 'ready' ? risk.value.assessmentState : 'Unknown'}</TerminalMetric>
        <TerminalMetric label="Risk stage" tone="terminal-warning">{risk.kind === 'ready' ? risk.value.stage ?? 'Unassessed' : 'Unknown'}</TerminalMetric>
        <TerminalMetric label="Evidence gate" tone="terminal-warning">{gate.kind === 'ready' ? gate.value.status.replaceAll('_', ' ') : 'Unknown'}</TerminalMetric>
        <TerminalMetric label="Exposure scale">{risk.kind === 'ready' ? risk.value.exposureScale ?? 'Unavailable' : 'Unknown'}</TerminalMetric>
      </dl>{risk.kind === 'ready' && risk.value.blockReason !== null && <p className="terminal-state-note">{risk.value.blockReason}</p>}
      <p className="terminal-footnote">Live charts are informational. Algorithm evidence uses completed decision bars. Active paper simulation does not imply permission to submit.</p>
    </section>
    <section className="terminal-panel"><header>Portfolio Summary <a href="#/portfolio/holdings">Assets →</a></header>
      <ChannelNotice state={portfolio} label="Connected portfolio" />
      <dl><TerminalMetric label="Connected value">{money(portfolio.kind === 'ready' ? portfolio.value?.totalValueUsd : null)}</TerminalMetric>
        <TerminalMetric label="Connected valuation">{portfolio.kind === 'ready' && portfolio.value !== null ? portfolio.value.complete ? 'Complete' : 'Incomplete' : 'Unavailable'}</TerminalMetric>
        <TerminalMetric label={primary === null ? 'Paper equity' : 'Exploratory equity'}>{money(primary === null ? paper.kind === 'ready' ? paper.value.totalValueUsd : null : primary.currentEquityUsd)}</TerminalMetric>
        <TerminalMetric label="Paper cash">{money(primary === null ? paper.kind === 'ready' ? paper.value.cashUsd : null : primary.balances.find((balance) => balance.exposureKey === 'USD')?.valueUsd)}</TerminalMetric>
        {primary !== null && <TerminalMetric label="After-cost return">{primary.paperReturnPct === null ? 'Unavailable' : `${primary.paperReturnPct.toFixed(2)}%`}</TerminalMetric>}
        <TerminalMetric label={primary === null ? "Max paper drawdown" : "Paper drawdown"}>{primary !== null ? primary.drawdownPct === null ? 'Unavailable' : `${primary.drawdownPct.toFixed(2)}%` : performance.kind === 'ready' ? `${performance.value.metrics.maxDrawdownPct}%` : 'Unavailable'}</TerminalMetric>
      </dl><p className="terminal-footnote">Active profile totals · Connected accounts: read-only · Paper: simulated · Performance after costs</p>
    </section>
  </div>;
}

export function TerminalAlgorithmDrawer({ client, productId, onClose, activity }: {
  readonly activity?: TerminalActivityState | undefined;
  readonly client: CoquiClient; readonly productId: string; readonly onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return <div className="terminal-drawer-backdrop" onClick={onClose}><div ref={ref} className="terminal-drawer" role="dialog" aria-modal="true" aria-labelledby="terminal-drawer-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
    <header><h2 id="terminal-drawer-title">Algorithm & evidence</h2><button type="button" aria-label="Close algorithm drawer" onClick={onClose}><X size={18} /></button></header>
    <TerminalAlgorithm client={client} productId={productId} activity={activity} />
  </div></div>;
}
