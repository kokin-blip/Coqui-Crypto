import { useState } from 'react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatQuantity } from '@coqui/ui-kit';

import { ResolveException } from './ResolveException.js';
import { useChannel } from '../query/use-channel.js';

type Reconciliation = ChannelResponse<'portfolio.reconciliation'>;
type Exception = Reconciliation['exceptions'][number];

/**
 * The reconciliation strip (wireframe screen 2, region 5).
 *
 * Read-only through P5; P7 gave it the append-only resolution ledger it was
 * waiting for. Invariant 12 governs what a resolution may be: an unexplained
 * balance is a *decision the user records*, never a zero-basis lot and never a
 * proportional rescale. The evidence row itself stays exactly as the venue
 * reported it — immutable by trigger — and a decision is a separate row
 * pointing at it.
 */

function direction(kind: Exception['discrepancy']['kind']): string {
  return kind === 'provider_exceeds_local'
    ? 'exchange reports more than the ledger'
    : 'the ledger holds more than the exchange';
}

function day(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

function Decision({ exception }: { readonly exception: Exception }): React.JSX.Element | null {
  const { resolution } = exception;
  if (resolution === null) return null;
  return (
    <p className="opacity-70">
      <span aria-hidden="true">{resolution.kind === 'investigating' ? '○' : '●'} </span>
      {resolution.kind.replaceAll('_', ' ')} · {day(resolution.decidedAt)} · {resolution.note}
      {exception.history.length > 1 && (
        <span> · {exception.history.length} decisions recorded</span>
      )}
    </p>
  );
}

function Row({
  exception,
  client,
  profileId,
  options,
}: {
  readonly exception: Exception;
  readonly client: CoquiClient;
  readonly profileId: string;
  readonly options: Reconciliation['options'];
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const item = exception.discrepancy;
  const unresolved =
    exception.resolution === null || exception.resolution.kind === 'investigating';

  return (
    <li className="py-1">
      <span className="font-semibold">{item.currency}</span>{' '}
      <span className="tabular-nums">
        exchange {formatQuantity(item.providerQuantity) ?? item.providerQuantity} vs ledger{' '}
        {formatQuantity(item.localQuantity) ?? item.localQuantity}
      </span>{' '}
      <span className="tabular-nums">
        · difference {formatQuantity(item.deltaQuantity) ?? item.deltaQuantity}
      </span>
      <span className="opacity-70">
        {' '}
        · {direction(item.kind)}
        {unresolved ? ' → needs your decision' : ''}
      </span>
      <button
        type="button"
        className="ml-3 underline"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        {open ? 'close' : unresolved ? 'resolve' : 'change decision'}
      </button>

      <Decision exception={exception} />

      {open && (
        <ResolveException
          client={client}
          profileId={profileId}
          discrepancyId={item.id}
          options={options}
        />
      )}
    </li>
  );
}

export function Reconciliation({
  client,
  profileId,
}: {
  readonly client: CoquiClient;
  readonly profileId: string;
}): React.JSX.Element {
  const reconciliation = useChannel(client, 'portfolio.reconciliation', { profileId });

  if (reconciliation.kind === 'loading') return <p aria-live="polite">Loading reconciliation…</p>;

  if (reconciliation.kind !== 'ready') {
    return (
      <p role="alert">
        Could not load reconciliation:{' '}
        {reconciliation.issues.map((issue) => issue.code).join(', ')}
      </p>
    );
  }

  const { exceptions, unresolvedCount, options, lastRunAtMs } = reconciliation.value;
  const lastRun =
    lastRunAtMs === null ? 'never run' : `${new Date(lastRunAtMs).toISOString().slice(11, 16)}Z`;

  return (
    <section aria-labelledby="reconciliation-heading" className="space-y-1 border-t pt-3">
      <h3 id="reconciliation-heading" className="font-semibold">
        Reconciliation
        <span className="ml-3 font-normal opacity-70">
          last run {lastRun} ·{' '}
          {exceptions.length === 0
            ? 'settled'
            : `${unresolvedCount} unresolved of ${exceptions.length}`}
        </span>
      </h3>

      {exceptions.length === 0 ? (
        <p className="opacity-70">
          {lastRunAtMs === null
            ? 'No Coinbase sync has run for this profile yet.'
            : 'The exchange and the ledger agree.'}
        </p>
      ) : (
        <>
          <ul>
            {exceptions.map((exception) => (
              <Row
                key={exception.discrepancy.id}
                exception={exception}
                client={client}
                profileId={profileId}
                options={options}
              />
            ))}
          </ul>
          {/*
            Invariant 12 stated on the surface. The predecessor closed these by
            inventing a zero-basis lot or rescaling existing ones; saying we do
            not is the point of showing them at all.
          */}
          <p className="opacity-70">
            Coqui will not invent a tax lot or rescale existing ones to close these. A
            resolution records what you decided; every decision is kept, and the exchange’s
            own figures are never edited.
          </p>
        </>
      )}
    </section>
  );
}
