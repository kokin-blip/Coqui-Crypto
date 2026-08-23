import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

type AlertsView = ChannelResponse<'alerts.view'>;
type AlertEvent = AlertsView['alerts'][number];
type PriceTarget = AlertsView['priceTargets'][number];

/**
 * What has fired, and what is being watched.
 *
 * The alerts service has recorded events since the transplant and nothing could
 * see them — the log existed and had no reader, which is the same shape of gap
 * as the scheduler with no wake-up. This is the reader.
 *
 * Read-only. Configuring rules is a write and belongs with settings; showing
 * what already happened does not need one.
 */

const KIND_LABEL: Record<AlertEvent['kind'], string> = {
  allocation_drift: 'drift',
  regime_change: 'regime',
  big_move: 'big move',
  price_target: 'price target',
  policy_event: 'policy',
  evidence_change: 'evidence',
};

function moment(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 16).replace('T', ' ');
}

function Row({ event }: { readonly event: AlertEvent }): React.JSX.Element {
  return (
    <li className={event.readAt === null ? 'py-1 font-semibold' : 'py-1 opacity-70'}>
      <span aria-hidden="true">{event.severity === 'warn' ? '▲ ' : '· '}</span>
      <span className="opacity-70">{moment(event.occurredAt)}</span> {KIND_LABEL[event.kind]}
      {event.productId !== null && <> · {event.productId}</>} ·{' '}
      {/* The stable reason code, never a raw upstream message. */}
      <span className="font-normal">{event.reasonCode.replaceAll('_', ' ')}</span>
      {event.readAt === null && <span className="sr-only"> (unread)</span>}
    </li>
  );
}

function Target({ target }: { readonly target: PriceTarget }): React.JSX.Element {
  return (
    <li className={target.enabled ? 'py-1' : 'py-1 opacity-60'}>
      {target.productId} {target.direction} ${target.priceUsd}
      {target.triggeredAt !== null && (
        <span className="opacity-70"> · triggered {moment(target.triggeredAt)}</span>
      )}
      {!target.enabled && <span className="opacity-70"> · disabled</span>}
    </li>
  );
}

export function Alerts({
  client,
  profileId,
}: {
  readonly client: CoquiClient;
  readonly profileId: string;
}): React.JSX.Element {
  const alerts = useChannel(client, 'alerts.view', { profileId });

  if (alerts.kind === 'loading') return <p aria-live="polite">Loading alerts…</p>;

  if (alerts.kind !== 'ready') {
    return (
      <p role="alert">Could not load alerts: {alerts.issues.map((issue) => issue.code).join(', ')}</p>
    );
  }

  const view = alerts.value;
  const active = view.priceTargets.filter((target) => target.removedAt === null);

  return (
    <section aria-labelledby="alerts-heading" className="space-y-2">
      <h2 id="alerts-heading" className="font-semibold">
        Alerts
        <span className="ml-3 font-normal opacity-70">
          {view.unreadCount} unread
          {view.config.quietHoursEnabled && (
            <>
              {' '}
              · quiet {view.config.quietStartHour}:00–{view.config.quietEndHour}:00 UTC
            </>
          )}
        </span>
      </h2>

      {view.alerts.length === 0 ? (
        <p className="opacity-70">Nothing has fired yet.</p>
      ) : (
        <ul>
          {view.alerts.map((event) => (
            <Row key={event.id} event={event} />
          ))}
        </ul>
      )}

      {active.length > 0 && (
        <>
          <h3 className="font-semibold">Price targets</h3>
          <ul>
            {active.map((target) => (
              <Target key={target.id} target={target} />
            ))}
          </ul>
        </>
      )}

      {view.config.quietHoursEnabled && (
        // The distinction matters: a suppressed notification is not a dropped
        // alert, and the record is here waiting either way.
        <p className="opacity-70">
          Quiet hours suppress the desktop notification, not the alert. Anything raised
          overnight is still listed here, unread.
        </p>
      )}
    </section>
  );
}
