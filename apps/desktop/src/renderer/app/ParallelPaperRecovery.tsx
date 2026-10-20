import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatApproxUsd } from '@coqui/ui-kit';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';
import { paperNetworkMessage } from './paper-network-message.js';

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
  const feeLimit = failure?.feeReconciliation;
  const pendingFees = failure?.pendingFeeEvidence;
  const networkMessage = paperNetworkMessage(failure);
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
    {attention.minorResolution && <p role="status">An earlier build accepted a paper-only position discrepancy ({formatApproxUsd(attention.minorResolution.valueUsd)}). Fee attribution remains unconfirmed. Current recovery requires exact quantities backed by reported fees; this historical checkpoint cannot clear a check.</p>}
    {attention.blocked && <section className="parallel-paper-decision" aria-label="Paper execution recovery">
    <SurfaceState kind="blocked" title={pendingFees ? pendingFees.status === 'overdue' ? 'Fee evidence overdue · review Alpaca' : 'Waiting for fee evidence' : feeLimit ? 'Position gap exceeds recovery limits' : preparationTimeout ? 'Market preparation timed out' : staleQuote ? 'Waiting for fresh Alpaca quotes' : 'New paper orders blocked until reconciliation completes'}
      detail={preparationTimeout ? 'The market-data refresh ran out of time during recovery. Coqui will retry while open. Trading remains paused until all recovery checks complete and you press Resume.' : staleQuote ? 'Alpaca returned an outdated execution quote. Coqui checks again automatically while open; fresh Coinbase display data does not replace Alpaca execution evidence. Recovery pricing checks use only assets with a discrepancy. Orders still require fresh prices before submission.' : 'Coqui rechecks the broker while this app is running. Recovery checks orders, fills, activities, and positions before the scheduler can submit again. Retry below to request another read check.'} compact />
    <dl className="settings-readout">
      <div><dt>Failed operation</dt><dd>{failure?.operation?.replaceAll('_', ' ') ?? (staleQuote ? 'Quote freshness' : 'Not recorded by the earlier build')}</dd></div>
      <div><dt>Latest diagnostic</dt><dd>{failure?.reason?.replaceAll('_', ' ') ?? 'No failure recorded'}
        {failure?.httpStatus != null && ` · HTTP ${failure.httpStatus}`}
        {failure?.attemptCount != null && ` · ${failure.attemptCount} attempts`}</dd></div>
      {failure?.networkCode && <div><dt>Network diagnostic</dt><dd>{failure.networkCode}</dd></div>}
      {failure?.elapsedMs != null && <div><dt>Elapsed time</dt><dd>{failure.elapsedMs > 0 && failure.elapsedMs < 1000
        ? `${Math.max(1, Math.round(failure.elapsedMs))}ms` : `${(failure.elapsedMs / 1000).toFixed(1)}s`}</dd></div>}
      {failure?.budgetMs != null && <div><dt>Check budget</dt><dd>{(failure.budgetMs / 1000).toFixed(1)}s</dd></div>}
      {failure?.remainingMs != null && <div><dt>Remaining budget</dt><dd>{(failure.remainingMs / 1000).toFixed(1)}s</dd></div>}
      {failure != null && <div><dt>Last failed recovery check</dt><dd><time dateTime={exactUtcTimestamp(failure.atMs)}>{formatLocalTimestamp(failure.atMs)}</time></dd></div>}
      <div><dt>Last complete reconciliation</dt><dd>{attention.lastSuccessfulAtMs === null ? 'Not yet recorded' :
        <time dateTime={exactUtcTimestamp(attention.lastSuccessfulAtMs)}>{formatLocalTimestamp(attention.lastSuccessfulAtMs)}</time>}</dd></div>
    </dl>
    {networkMessage && <p role="status">{networkMessage}</p>}
    {pendingFees && <div role="status">
      <p>The missing quantities resemble crypto buy fees that Alpaca has not yet reported. Alpaca may publish fee activities after the trade day. This is unconfirmed; Coqui has not booked estimated fees or accepted the gap.</p>
      <p>Oldest affected fill: <time dateTime={exactUtcTimestamp(pendingFees.oldestFillAtMs)}>{formatLocalTimestamp(pendingFees.oldestFillAtMs)}</time>
        {failure && ` · ${Math.max(0, Math.floor((failure.atMs - pendingFees.oldestFillAtMs) / 3_600_000))}h before the latest check`}.</p>
      <p>{pendingFees.status === 'overdue' ? 'Fee evidence is still missing beyond the review threshold. Check the Alpaca paper dashboard or contact Alpaca support; elapsed time does not clear this block.' : 'Coqui rechecks the full activity history while open. If evidence is still missing after the review threshold, Coqui will flag it for review.'}
        {' '}Review threshold: <time dateTime={exactUtcTimestamp(pendingFees.reviewAfterMs)}>{formatLocalTimestamp(pendingFees.reviewAfterMs)}</time>. This is a review reminder, not a promised posting time.</p>
      <p>All new paper orders remain blocked until reported fees and positions reconcile exactly. Recovery never resumes trading automatically; press Resume only after the checks pass.</p>
    </div>}
    {feeLimit && <p role="status">The fee-shaped position gap is valued at {formatApproxUsd(feeLimit.observedValueUsd)}.
      Recovery requires the gap to stay within both {formatApproxUsd(feeLimit.maxAbsoluteValueUsd)} and 0.05% of account equity ({formatApproxUsd(feeLimit.maxEquityValueUsd)}).
      Fee attribution remains unconfirmed. Coqui will recheck the full activity history for reported fees; trading remains paused.</p>}
    {(failure?.positionDifferences?.length ?? 0) > 0 && <>
      <p>Alpaca quantities differ from recorded fills minus reported crypto fees. A billing date is not the fee creation time. Recovery requires exact accounting at every value; unexplained differences remain blocked.</p>
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
