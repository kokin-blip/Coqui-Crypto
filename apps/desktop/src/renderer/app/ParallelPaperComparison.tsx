import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';
import { SurfaceState } from './SurfaceState.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';
import { CoinbaseMarketContext } from './CoinbaseMarketContext.js';

type Status = ChannelResponse<'parallel.paper.status'>;
const DAY_MS = 86_400_000;
const DECISION_WINDOW_MS = 15 * 60_000;

function usd(value: string | null): string {
  return value === null ? 'Awaiting daily mark' : '$' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(value: string | null): string {
  return value === null ? 'Awaiting daily mark' : (Number(value) >= 0 ? '+' : '') + value + '%';
}

function stateLabel(data: Status, dailyWindowOpen: boolean): string {
  switch (data.runtimeState) {
    case 'none': return 'Not started';
    case 'awaiting': return data.lastCheckAtMs === null ? 'Awaiting first scheduler check'
      : data.lastDecisionAtMs === null ? dailyWindowOpen ? 'Daily decision window is open' : 'Waiting for the daily decision window'
        : 'Awaiting next completed daily bar';
    case 'evaluating': return 'Checking market data and Alpaca';
    case 'order_pending': return 'Alpaca order activity pending';
    case 'reconciled': return 'Daily pass reconciled · monitoring intraday';
    case 'intraday': return 'Monitoring intraday paper rebalances';
    case 'paused': return 'Paused by you';
    case 'attention': return data.state === 'paused' ? 'Needs attention' : 'Scheduler check overdue';
    case 'stopped': return 'Stopped';
  }
}

function decisionWindowStatus(nowMs: number): { readonly open: boolean; readonly nextAtMs: number } {
  const date = new Date(nowMs);
  const todayUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const elapsed = nowMs - todayUtc;
  const open = elapsed < DECISION_WINDOW_MS;
  return { open, nextAtMs: open ? todayUtc : todayUtc + DAY_MS };
}

function timestamp(atMs: number | null): React.JSX.Element | string {
  return atMs === null ? 'Not yet recorded' : <time dateTime={exactUtcTimestamp(atMs)} title={exactUtcTimestamp(atMs)}>{formatLocalTimestamp(atMs)}</time>;
}

export function ParallelPaperComparison({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const status = useChannel(client, 'parallel.paper.status', {});
  return <section className="panel parallel-paper-activity" aria-labelledby="parallel-comparison-heading">
    <div className="panel-heading"><div><h2 id="parallel-comparison-heading">Alpaca paper activity</h2>
      <p className="muted">TrendVol v4.2 daily targets · Alpaca paper rebalance checks every four hours</p></div>
      <a href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noreferrer">Open Alpaca paper dashboard</a></div>
    {status.kind === 'loading' && <SurfaceState kind="loading" title="Reading Alpaca paper activity" compact />}
    {status.kind !== 'loading' && status.kind !== 'ready' && <SurfaceState kind="error"
      title="Alpaca activity unavailable" detail={status.issues.map((issue) => issue.code).join(', ')} compact />}
    {status.kind === 'ready' && status.value.state === 'none' && <SurfaceState kind="empty"
      title="No Alpaca paper experiment yet"
      detail="Connect a dedicated Alpaca paper account, then start the parallel experiment in Settings → Paper."
      action={{ label: 'Open Settings', href: '#/settings' }} compact />}
    {status.kind === 'ready' && status.value.state !== 'none' && <ActivityContent data={status.value} />}
    <section className="coinbase-paper-context" aria-label="Coinbase market context"><div className="panel-heading"><div><h3>Coinbase market context</h3><p className="muted">Current venue snapshots · informational only · separate from Alpaca orders</p></div><a href="#/markets">Open Markets for book depth</a></div>
      <div className="coinbase-paper-context-grid">{['BTC-USD', 'ETH-USD', 'LTC-USD'].map((productId) =>
        <CoinbaseMarketContext key={productId} client={client} productId={productId} compact />)}</div>
    </section>
  </section>;
}

function ActivityContent({ data }: { readonly data: Status }): React.JSX.Element {
  const decision = data.latestDecision;
  const window = decisionWindowStatus(Date.now());
  return <>
    <div className="parallel-paper-current" role="status">
      <strong>{stateLabel(data, window.open)}</strong>
      <span>Last scheduler check: {timestamp(data.lastCheckAtMs)}</span>
      <span>Last daily decision: {timestamp(data.lastDecisionAtMs)}</span>
    </div>
    <p className="muted">Daily targets update from completed Coinbase bars. At 04:00, 08:00, 12:00, 16:00, and 20:00 UTC, Coqui can rebalance the Alpaca paper account when fresh Alpaca quotes show at least 1% portfolio drift and a $25 trade. No price move means no order.</p>
    {data.lastReason !== null && <SurfaceState kind="blocked" title="New Alpaca orders paused"
      detail={data.lastReason.replaceAll('_', ' ')} compact />}
    {data.runtimeState === 'attention' && data.state === 'active' && <SurfaceState kind="blocked"
      title="Scheduler has not checked recently" detail="Keep Coqui open and inspect the local scheduler before assuming another order will be sent." compact />}
    {decision !== null && <div className="parallel-paper-decision">
      <h3>Latest algorithm decision · {decision.day}</h3>
      <p>Trend {decision.belowTrend ? 'below' : 'above'} reference · realized mix volatility {decision.mixVolPct}% · target exposure {decision.exposurePct}% · target cash {decision.cashPct}%</p>
      {decision.filters !== null && <p className="muted">Defensive reads today: negative momentum in {decision.filters.negativeMomentumAssets} assets; asset volatility scaling in {decision.filters.assetVolScaledAssets}; portfolio volatility target {decision.filters.portfolioVolScaled ? 'applied' : 'inactive'}; trend cap {decision.filters.trendCapApplied ? 'applied' : 'inactive'}.</p>}
      <ul>{decision.targets.map((target) => <li key={target.symbol}>{target.symbol} <strong>{target.weightPct}%</strong></li>)}</ul>
      {data.filterSummary.observedDecisions > 0 && <p className="muted">Across {data.filterSummary.observedDecisions} recorded daily decisions: negative momentum {data.filterSummary.negativeMomentumDays} days · asset volatility scaling {data.filterSummary.assetVolScaledDays} days · portfolio volatility target {data.filterSummary.portfolioVolScaledDays} days · trend cap {data.filterSummary.trendCapDays} days.</p>}
    </div>}
    <div className="parallel-paper-timeline"><h3>Recorded activity</h3>
      {data.activity.length === 0 ? <p className="muted">No daily decision recorded yet. Coqui evaluates the latest completed Coinbase bar while open. Daily orders use the 00:00–00:15 UTC window; later intraday checks can use the same target.
        {data.lastCheckAtMs !== null && (window.open
          ? ' This window is open; the next scheduler check can evaluate today’s bar.'
          : <> Today’s window has passed. The next attempt is <time dateTime={exactUtcTimestamp(window.nextAtMs)} title={exactUtcTimestamp(window.nextAtMs)}>{formatLocalTimestamp(window.nextAtMs)}</time>.</>)}</p>
        : <ol>{data.activity.map((item) => <li key={item.id} data-kind={item.kind}>
          <div><strong>{item.title}</strong>{timestamp(item.atMs)}</div>
          <p>{item.detail}</p>
          {item.alpacaOrderId !== null && <small>Alpaca order ID <code>{item.alpacaOrderId}</code></small>}
        </li>)}</ol>}
    </div>
    <details className="parallel-paper-financials"><summary>Balances, returns, and paper fills</summary>
      <p className="muted">Coqui is a daily-fill baseline. Alpaca can rebalance intraday, so these returns are not execution-matched. Alpaca fills come from its external paper simulator; times and fees can differ. Last recorded mark: {data.lastMarkDay ?? 'pending'}.</p>
      <div className="parallel-paper-grid">
        <article><h3>Coqui · Coinbase-sized simulator</h3><dl className="settings-readout">
          <div><dt>Opening</dt><dd>{usd(data.coquiOpeningUsd)}</dd></div>
          <div><dt>Equity</dt><dd>{usd(data.coquiEquityUsd)}</dd></div>
          <div><dt>Return after modeled costs</dt><dd>{pct(data.coquiReturnPct)}</dd></div>
          <div><dt>Modeled fees</dt><dd>{usd(data.coquiFeesUsd)}</dd></div>
          <div><dt>Local fills</dt><dd>{data.coquiFillCount}</dd></div>
        </dl></article>
        <article><h3>Alpaca · external paper account</h3><dl className="settings-readout">
          <div><dt>Opening</dt><dd>{usd(data.alpacaOpeningUsd)}</dd></div>
          <div><dt>Equity</dt><dd>{usd(data.alpacaEquityUsd)}</dd></div>
          <div><dt>Return on Alpaca account</dt><dd>{pct(data.alpacaReturnPct)}</dd></div>
          <div><dt>Booked fees</dt><dd>{data.alpacaBookedFeesUsd === null ? 'Not reported separately' : usd(data.alpacaBookedFeesUsd)}</dd></div>
          <div><dt>Cost-model envelope</dt><dd>{usd(data.alpacaModeledFrictionUsd)} · not deducted again</dd></div>
          <div><dt>Orders / paper fills</dt><dd>{data.alpacaOrderCount} / {data.alpacaFillCount}</dd></div>
        </dl></article>
      </div>
      {data.positions.length > 0 && <div className="parallel-paper-positions"><h3>Holdings and target weights</h3>
        <table><thead><tr><th>Asset</th><th>Target</th><th>Coqui quantity</th><th>Alpaca paper quantity</th></tr></thead>
          <tbody>{data.positions.map((item) => <tr key={item.symbol}><td>{item.symbol}</td><td>{data.targets.find((target) => target.symbol === item.symbol)?.weightPct ?? '—'}%</td><td>{item.coquiQty}</td><td>{item.alpacaQty}</td></tr>)}</tbody></table>
      </div>}
      {data.recentTrades.length > 0 && <div className="parallel-paper-positions"><h3>Recent recorded fills</h3>
        <table><thead><tr><th>System</th><th>Recorded</th><th>Asset</th><th>Quantity</th><th>Price</th></tr></thead>
          <tbody>{data.recentTrades.toReversed().map((item, index) => <tr key={item.source + item.atMs + index}><td>{item.source === 'coqui' ? 'Coqui model' : 'Alpaca paper'}</td><td>{formatLocalTimestamp(item.atMs)}</td><td>{item.symbol}</td><td>{item.quantity}</td><td>{item.price}</td></tr>)}</tbody></table>
      </div>}
    </details>
  </>;
}
