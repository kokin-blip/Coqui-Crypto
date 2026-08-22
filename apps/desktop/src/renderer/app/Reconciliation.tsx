import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatQuantity } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';

type Discrepancy = ChannelResponse<'portfolio.reconciliation'>['discrepancies'][number];

/**
 * The reconciliation strip (wireframe screen 2, region 5).
 *
 * Read-only in this phase, deliberately. Invariant 12 makes an unexplained
 * balance a *user decision*, and the evidence rows are immutable by database
 * trigger, so closing one needs a separate append-only record. That table
 * arrives with P7's single reconciliation ledger — building a resolve path here
 * would build that ledger twice.
 *
 * What the strip must do meanwhile is refuse to hide the exceptions, and say
 * plainly that Coqui will not close them by itself.
 */

function direction(kind: Discrepancy['kind']): string {
  return kind === 'provider_exceeds_local'
    ? 'exchange reports more than the ledger'
    : 'the ledger holds more than the exchange';
}

function Row({ item }: { readonly item: Discrepancy }): React.JSX.Element {
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
      <span className="opacity-70"> · {direction(item.kind)} → needs your decision</span>
    </li>
  );
}

export function Reconciliation({
  client,
}: {
  readonly client: CoquiClient;
}): React.JSX.Element {
  const reconciliation = useChannel(client, 'portfolio.reconciliation', {});

  if (reconciliation.kind === 'loading') return <p aria-live="polite">Loading reconciliation…</p>;

  if (reconciliation.kind !== 'ready') {
    return (
      <p role="alert">
        Could not load reconciliation:{' '}
        {reconciliation.issues.map((issue) => issue.code).join(', ')}
      </p>
    );
  }

  const { discrepancies, lastRunAtMs } = reconciliation.value;
  const lastRun =
    lastRunAtMs === null ? 'never run' : `${new Date(lastRunAtMs).toISOString().slice(11, 16)}Z`;

  return (
    <section aria-labelledby="reconciliation-heading" className="space-y-1 border-t pt-3">
      <h3 id="reconciliation-heading" className="font-semibold">
        Reconciliation
        <span className="ml-3 font-normal opacity-70">
          last run {lastRun} ·{' '}
          {discrepancies.length === 0
            ? 'settled'
            : `${discrepancies.length} exception${discrepancies.length === 1 ? '' : 's'}, unresolved`}
        </span>
      </h3>

      {discrepancies.length === 0 ? (
        <p className="opacity-70">
          {lastRunAtMs === null
            ? 'No Coinbase sync has run for this profile yet.'
            : 'The exchange and the ledger agree.'}
        </p>
      ) : (
        <>
          <ul>
            {discrepancies.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
          {/*
            Invariant 12 stated on the surface. The predecessor closed these by
            inventing a zero-basis lot or rescaling existing ones; saying we do
            not is the point of showing them at all.
          */}
          <p className="opacity-70">
            Coqui will not invent a tax lot or rescale existing ones to close these. Resolving
            an exception is a decision you record, and that path arrives with the Coinbase
            import ledger.
          </p>
        </>
      )}
    </section>
  );
}
