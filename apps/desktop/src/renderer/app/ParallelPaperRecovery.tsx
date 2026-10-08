import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatApproxUsd } from '@coqui/ui-kit';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';

const INVALIDATES = ['parallel.paper.status'] as const;
export function ParallelPaperRecovery({ client, data }: {
  readonly client: CoquiClient; readonly data: ChannelResponse<'parallel.paper.status'>;
}): React.JSX.Element | null {
  const retry = useCommand(client, 'parallel.paper.reconcile', INVALIDATES);
  const attention = data.reconciliationAttention;
  if (data.experimentId === null) return null;
  const failure = attention.latestFailure;
  const evidence = data.brokerEvidence;
  const staleQuote = failure?.reason === 'stale_alpaca_quote';
  const preparationTimeout = failure?.reason === 'deadline_exceeded' && failure.operation === 'market_preparation';
  return <>
    {data.state === 'active' && data.latestPass?.outcome === 'deferred' && <SurfaceState kind="empty"
      title="Waiting for a complete check"
      detail={`The ${data.latestPass.phase.replaceAll('_', ' ')} check ran out of time before an order was submitted. Coqui will retry automatically; orders wait for complete checks.`} />}

    {evidence && <section className="parallel-paper-decision" aria-label="Alpaca broker evidence">
      <h3>Alpaca broker evidence</h3>
      <dl className="settings-readout">
        <div><dt>Execution stream</dt><dd>{evidence.tradeStream} · {evidence.capturedExecutionCount} captured fills</dd></div>
        <div><dt>Alpaca quote freshness</dt><dd>{evidence.quoteStatus}</dd></div>
        <div><dt>Position reconciliation</dt><dd>{evidence.positionStatus}</dd></div>
        <div><dt>Fee coverage</dt><dd>{evidence.feeCoverage === 'no_fills' ? 'No fills recorded' : 'Completeness unconfirmed'}</dd></div>
      </dl>
      {evidence.quoteAssets && <div className="table-scroll"><table aria-label="Alpaca US quote timestamps">
        <thead><tr><th>Asset</th><th>Quote freshness</th><th>Quote timestamp</th><th>Last response</th></tr></thead>
        <tbody>{evidence.quoteAssets.map(row => <tr key={row.symbol}>
          <td>{row.symbol}</td><td>{row.status}{row.ageSeconds !== null && ` · ${row.ageSeconds}s old`}</td>
          <td>{row.quoteAtMs === null ? 'Unavailable' : <time dateTime={exactUtcTimestamp(row.quoteAtMs)}>{formatLocalTimestamp(row.quoteAtMs)}</time>}</td>
          <td>{row.receivedAtMs === null ? 'Not yet checked' : <time dateTime={exactUtcTimestamp(row.receivedAtMs)}>{formatLocalTimestamp(row.receivedAtMs)}</time>}</td>
        </tr>)}</tbody></table></div>}
      <p className="muted">Quote timestamps describe provider events; last response describes the API read. Resume arms the scheduler; fresh prices for the assets needed by each order are checked before submission.</p>
      <p className="muted">Coinbase market-feed health is separate from Alpaca execution readiness. Captured stream positions do not replace the accounting guard.</p>
      {evidence.latestFeeCreatedAtMs !== null && <p>Latest reported fee created <time dateTime={exactUtcTimestamp(evidence.latestFeeCreatedAtMs)}>{formatLocalTimestamp(evidence.latestFeeCreatedAtMs)}</time>.</p>}
      {evidence.latestFillAtMs !== null && <p>Latest fill <time dateTime={exactUtcTimestamp(evidence.latestFillAtMs)}>{formatLocalTimestamp(evidence.latestFillAtMs)}</time>.</p>}
    </section>}
    {data.state === 'paused' && !attention.blocked && <SurfaceState kind="success" title="Recovery complete · ready to resume"
      detail="The paper account checks passed. Trading remains paused until you press Resume; Resume checks the broker again. Orders still require fresh execution prices." compact />}
    {attention.minorResolution && <p role="status">A small paper-only position discrepancy ({formatApproxUsd(attention.minorResolution.valueUsd)}) was accepted from broker evidence. Fee attribution remains unconfirmed. Recorded fills, fees, and tax lots were not changed.</p>}
    {attention.blocked && <section className="parallel-paper-decision" aria-label="Paper execution recovery">
    <SurfaceState kind="blocked" title={preparationTimeout ? 'Market preparation timed out' : staleQuote ? 'Waiting for fresh Alpaca quotes' : 'New paper orders blocked until reconciliation completes'}
      detail={preparationTimeout ? 'The market-data refresh ran out of time during recovery. Coqui will retry while open. Trading remains paused until all recovery checks complete and you press Resume.' : staleQuote ? 'Alpaca returned an outdated execution quote. Coqui checks again automatically while open; fresh Coinbase display data does not replace Alpaca execution evidence. Recovery pricing checks use only assets with a discrepancy. Orders still require fresh prices before submission.' : 'Coqui rechecks the broker while this app is running. Recovery checks orders, fills, activities, and positions before the scheduler can submit again. Retry below to request another read check.'} compact />
    <dl className="settings-readout">
      <div><dt>Failed operation</dt><dd>{failure?.operation?.replaceAll('_', ' ') ?? (staleQuote ? 'Quote freshness' : 'Not recorded by the earlier build')}</dd></div>
      <div><dt>Latest diagnostic</dt><dd>{failure?.reason?.replaceAll('_', ' ') ?? 'No failure recorded'}
        {failure?.httpStatus != null && ` · HTTP ${failure.httpStatus}`}
        {failure?.attemptCount != null && ` · ${failure.attemptCount} attempts`}</dd></div>
      {failure?.elapsedMs != null && <div><dt>Elapsed time</dt><dd>{(failure.elapsedMs / 1000).toFixed(1)}s</dd></div>}
      {failure?.budgetMs != null && <div><dt>Check budget</dt><dd>{(failure.budgetMs / 1000).toFixed(1)}s</dd></div>}
      {failure?.remainingMs != null && <div><dt>Remaining budget</dt><dd>{(failure.remainingMs / 1000).toFixed(1)}s</dd></div>}
      {failure != null && <div><dt>Last failed recovery check</dt><dd><time dateTime={exactUtcTimestamp(failure.atMs)}>{formatLocalTimestamp(failure.atMs)}</time></dd></div>}
      <div><dt>Last complete reconciliation</dt><dd>{attention.lastSuccessfulAtMs === null ? 'Not yet recorded' :
        <time dateTime={exactUtcTimestamp(attention.lastSuccessfulAtMs)}>{formatLocalTimestamp(attention.lastSuccessfulAtMs)}</time>}</dd></div>
    </dl>
    {(failure?.positionDifferences?.length ?? 0) > 0 && <>
      <p>Alpaca quantities differ from recorded fills minus reported crypto fees. Alpaca can publish fees after the fill; a billing date is not the fee creation time. Delayed fees may explain this difference. Recovery can accept a small, fee-shaped discrepancy after a full audit and fresh broker checks; larger or unexplained differences remain blocked.</p>
      <div className="table-scroll"><table aria-label="Paper position differences"><thead><tr>
        <th>Asset</th><th>Recorded quantity</th><th>Alpaca quantity</th><th>Difference</th>
      </tr></thead><tbody>{failure!.positionDifferences!.map(row => <tr key={row.symbol}>
        <td>{row.symbol}</td><td>{row.expectedQty}</td><td>{row.observedQty}</td><td>{row.differenceQty}</td>
      </tr>)}</tbody></table></div>
    </>}
    {attention.unresolvedOrders.length > 0 && <details open><summary>Orders requiring reconciliation</summary>
      <ul>{attention.unresolvedOrders.map((order) => <li key={order.clientOrderId}>Client order ID <code>{order.clientOrderId}</code>
        {order.orderId !== null && <> · Alpaca order ID <code>{order.orderId}</code></>}</li>)}</ul>
    </details>}
    <p><a href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noreferrer">Check Alpaca paper dashboard</a></p>
    <button type="button" className="button-secondary" disabled={retry.state.kind === 'pending'}
      onClick={() => void retry.run({ commandId: crypto.randomUUID() })}>
      {retry.state.kind === 'pending' ? 'Reconciling paper account…' : 'Retry reconciliation'}
    </button>
    {retry.state.kind === 'succeeded' && <p role="status">Read check finished; recovery remains blocked. Review the latest diagnostic. No trading was enabled.</p>}
    {(retry.state.kind === 'failed' || retry.state.kind === 'blocked') && <p role="alert">Reconciliation could not run. Keep Coqui open on the authoritative host, then retry.</p>}
    </section>}
  </>;
}
