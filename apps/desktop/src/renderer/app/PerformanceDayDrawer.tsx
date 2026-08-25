import { useEffect, useRef } from 'react';

import type { CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';

export function PerformanceDayDrawer({
  client,
  dayUtc,
  onClose,
}: {
  readonly client: CoquiClient;
  readonly dayUtc: number;
  readonly onClose: () => void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const day = useChannel(client, 'paper.performance-day', { dayUtc });

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog ref={dialog} className="day-drawer" onClose={onClose} aria-labelledby="day-drawer-heading">
      <div className="day-drawer-content">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Paper evidence</p>
            <h2 id="day-drawer-heading">{new Date(dayUtc).toISOString().slice(0, 10)}</h2>
          </div>
          <button className="button-quiet" onClick={() => dialog.current?.close()}>Close</button>
        </div>
        {day.kind === 'loading' && <p aria-live="polite">Loading day evidence…</p>}
        {day.kind !== 'loading' && day.kind !== 'ready' && (
          <p role="alert">Could not load this day: {day.issues.map((issue) => issue.code).join(', ')}</p>
        )}
        {day.kind === 'ready' && (
          <>
            {day.value.evidence === null ? (
              <p className="empty-state">No immutable valuation was captured for this day.</p>
            ) : (
              <dl className="metric-grid compact-metrics">
                <div><dt>Paper equity</dt><dd>{day.value.evidence.equityUsd === null ? 'Incomplete' : formatUsd(day.value.evidence.equityUsd)?.text}</dd></div>
                <div><dt>Cash</dt><dd>{formatUsd(day.value.evidence.cashUsd)?.text}</dd></div>
                <div><dt>Unpriced</dt><dd>{day.value.evidence.unpricedCount}</dd></div>
                <div><dt>Evidence</dt><dd>{day.value.evidence.evidenceHash.slice(0, 10)}…</dd></div>
              </dl>
            )}
            <section>
              <h3>Fills and costs</h3>
              {day.value.fills.length === 0 ? <p className="muted">No recorded paper fills.</p> : (
                <ul className="day-event-list">
                  {day.value.fills.map((fill) => (
                    <li key={fill.orderId}>
                      <strong>{fill.side.toUpperCase()} {fill.productId}</strong>
                      <span>{fill.quantity} @ {formatUsd(fill.executionPrice)?.text}</span>
                      <span>fee {formatUsd(fill.venueFeeUsd)?.text} · spread {formatUsd(fill.spreadUsd)?.text} · slippage {formatUsd(fill.slippageUsd)?.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>State transitions</h3>
              {day.value.transitions.length === 0 ? <p className="muted">No order transitions.</p> : (
                <ol className="transition-list">
                  {day.value.transitions.map((event) => (
                    <li key={`${event.orderId}:${event.sequence}`}>
                      <time>{new Date(event.at).toISOString().slice(11, 19)}Z</time>
                      <strong>{event.state.replaceAll('_', ' ')}</strong>
                      <span>{event.orderId.slice(0, 10)}…</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </dialog>
  );
}
