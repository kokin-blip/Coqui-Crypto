import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatQuantity, formatUsd } from '@coqui/ui-kit';

import { DeferredPanel } from './DeferredPanel.js';
import { useChannel } from '../query/use-channel.js';

type TaxView = ChannelResponse<'portfolio.tax'>;

/**
 * The tax ledger.
 *
 * Everything on this screen is an **estimate**, stated as such. Coqui computes
 * disposals from its own lots with a declared cost-basis method; it is not a
 * tax return and does not know the user's jurisdiction or bracket.
 */

function Money({ value, signed = false }: { readonly value: string; readonly signed?: boolean }) {
  const formatted = formatUsd(value, { signed });
  if (formatted === null) return <span>—</span>;
  return (
    <>
      {signed && <span aria-hidden="true">{formatted.figure.marker} </span>}
      {formatted.text}
    </>
  );
}

export function Tax({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const tax = useChannel(client, 'portfolio.tax', {});

  if (tax.kind === 'loading') return <p aria-live="polite">Loading tax ledger…</p>;
  if (tax.kind !== 'ready') {
    return (
      <p role="alert">Could not load tax: {tax.issues.map((issue) => issue.code).join(', ')}</p>
    );
  }

  const view: TaxView = tax.value;

  return (
    <section aria-labelledby="tax-heading" className="space-y-4">
      <h2 id="tax-heading" className="font-semibold">
        Tax
      </h2>

      <p role="note" className="border-l-2 pl-3">
        <span aria-hidden="true">⚠ </span>
        Every figure here is an <span className="font-semibold">estimate</span> computed from
        Coqui&rsquo;s own lots. It is not a tax return, and it does not know your jurisdiction.
      </p>

      <dl className="grid grid-cols-[14rem_1fr] gap-x-4">
        <dt>realised this year</dt>
        <dd className="tabular-nums"><Money value={view.summary.ytdRealizedUsd} signed /></dd>
        <dt>realised all time</dt>
        <dd className="tabular-nums"><Money value={view.summary.allTimeRealizedUsd} signed /></dd>
        <dt>short-term this year</dt>
        <dd className="tabular-nums"><Money value={view.summary.ytdShortTermUsd} signed /></dd>
        <dt>long-term this year</dt>
        <dd className="tabular-nums"><Money value={view.summary.ytdLongTermUsd} signed /></dd>
        <dt>disposals recorded</dt>
        <dd className="tabular-nums">{view.summary.disposalCount}</dd>
      </dl>

      {view.disposals.length === 0 ? (
        <p>No disposals recorded yet.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Recorded disposals with cost basis and realised P&amp;L</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="pr-4 font-normal opacity-70">ASSET</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">QTY</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">PROCEEDS</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">BASIS</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">REALISED</th>
              <th scope="col" className="font-normal opacity-70">TERM · METHOD</th>
            </tr>
          </thead>
          <tbody>
            {view.disposals.map((disposal) => (
              <tr key={disposal.id}>
                <th scope="row" className="pr-4 text-left font-normal">{disposal.asset.symbol}</th>
                <td className="pr-4 text-right tabular-nums">
                  {formatQuantity(disposal.quantity) ?? disposal.quantity}
                </td>
                <td className="pr-4 text-right tabular-nums"><Money value={disposal.proceedsUsd} /></td>
                <td className="pr-4 text-right tabular-nums"><Money value={disposal.costBasisUsd} /></td>
                <td className="pr-4 text-right tabular-nums">
                  <Money value={disposal.realizedPnlUsd} signed />
                </td>
                <td>
                  {disposal.longTerm ? 'long' : 'short'} · {disposal.method} · {disposal.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DeferredPanel
        title="Loss harvesting"
        phase="P8"
        reason="Harvest suggestions need the estimate-bearing service that ships with the risk surfaces."
      />
    </section>
  );
}
