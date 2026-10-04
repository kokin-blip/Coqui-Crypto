import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { useCommand } from '../query/use-command.js';
import { SurfaceState } from './SurfaceState.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';

const INVALIDATES = ['parallel.paper.status'] as const;
export function ParallelPaperRecovery({ client, data }: {
  readonly client: CoquiClient; readonly data: ChannelResponse<'parallel.paper.status'>;
}): React.JSX.Element | null {
  const retry = useCommand(client, 'parallel.paper.reconcile', INVALIDATES);
  const attention = data.reconciliationAttention;
  if (!attention.blocked) return null;
  const failure = attention.latestFailure;
  return <section className="parallel-paper-decision" aria-label="Paper execution recovery">
    <SurfaceState kind="blocked" title="New paper orders blocked until reconciliation completes"
      detail="Check the Alpaca paper dashboard, then retry reconciliation. Recovery checks orders, fills, activities, and positions before the scheduler can submit again." compact />
    <dl className="settings-readout">
      <div><dt>Failed operation</dt><dd>{failure?.operation?.replaceAll('_', ' ') ?? 'Not recorded by the earlier build'}</dd></div>
      <div><dt>Latest diagnostic</dt><dd>{failure?.reason?.replaceAll('_', ' ') ?? 'No failure recorded'}
        {failure?.httpStatus != null && ` · HTTP ${failure.httpStatus}`}
        {failure?.attemptCount != null && ` · ${failure.attemptCount} attempts`}</dd></div>
      <div><dt>Last complete reconciliation</dt><dd>{attention.lastSuccessfulAtMs === null ? 'Not yet recorded' :
        <time dateTime={exactUtcTimestamp(attention.lastSuccessfulAtMs)}>{formatLocalTimestamp(attention.lastSuccessfulAtMs)}</time>}</dd></div>
    </dl>
    {attention.unresolvedOrders.length > 0 && <details open><summary>Orders requiring reconciliation</summary>
      <ul>{attention.unresolvedOrders.map((order) => <li key={order.clientOrderId}>Client order ID <code>{order.clientOrderId}</code>
        {order.orderId !== null && <> · Alpaca order ID <code>{order.orderId}</code></>}</li>)}</ul>
    </details>}
    <p><a href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noreferrer">Check Alpaca paper dashboard</a></p>
    <button type="button" className="button-secondary" disabled={retry.state.kind === 'pending'}
      onClick={() => void retry.run({ commandId: crypto.randomUUID() })}>
      {retry.state.kind === 'pending' ? 'Reconciling paper account…' : 'Retry reconciliation'}
    </button>
    {retry.state.kind === 'succeeded' && <p role="status">Read check finished. Review the latest reconciliation status; the scheduler retains the existing order windows.</p>}
    {(retry.state.kind === 'failed' || retry.state.kind === 'blocked') && <p role="alert">Reconciliation could not run. Keep Coqui open on the authoritative host, then retry.</p>}
  </section>;
}
