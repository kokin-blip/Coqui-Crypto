import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatPercent, formatUsd } from '@coqui/ui-kit';

import { DeferredPanel } from './DeferredPanel.js';
import { useChannel } from '../query/use-channel.js';

type AllocationView = ChannelResponse<'portfolio.allocation'>;

/**
 * Allocation targets, drift, and the rebalance plan.
 *
 * The plan is an **estimate**. `estimateOnly` is a literal `true` on the wire
 * and this screen never offers a control that would act on it — there is no
 * executor in this build, and P8 keeps the flag rather than removing it.
 */

const PLAN_STATUS_COPY: Readonly<Record<AllocationView['planStatus'], string>> = {
  available: 'Estimated trades to return to target. Nothing here can be executed.',
  no_policy: 'No allocation policy is set, so there is nothing to drift from.',
  blocked_incomplete_pricing:
    'Some holdings could not be priced, so a plan would be computed from a partial book.',
  blocked_non_venue_pricing:
    'Pricing fell back to a reference source. A plan needs venue-reported prices.',
  blocked_target_coverage:
    'The policy does not cover every held asset, so drift cannot be computed for all of them.',
};

function Drift({ value }: { readonly value: number | null }): React.JSX.Element {
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">no target set for this asset</span>
      </>
    );
  }
  const formatted = formatPercent(value);
  return formatted === null ? <span>—</span> : (
    <>
      <span aria-hidden="true">{formatted.figure.marker}</span> {formatted.text}
    </>
  );
}

export function Allocation({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const allocation = useChannel(client, 'portfolio.allocation', {});

  if (allocation.kind === 'loading') return <p aria-live="polite">Loading allocation…</p>;
  if (allocation.kind !== 'ready') {
    return (
      <p role="alert">
        Could not load allocation: {allocation.issues.map((issue) => issue.code).join(', ')}
      </p>
    );
  }

  const view = allocation.value;
  const planned = view.planStatus === 'available';

  return (
    <section aria-labelledby="allocation-heading" className="space-y-4">
      <h2 id="allocation-heading" className="font-semibold">
        Allocation
      </h2>

      {view.allocation.slices.length === 0 ? (
        <p>Nothing to allocate yet.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Actual versus target weight and drift per asset</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="pr-4 font-normal opacity-70">ASSET</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">VALUE</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">ACTUAL</th>
              <th scope="col" className="pr-4 text-right font-normal opacity-70">TARGET</th>
              <th scope="col" className="text-right font-normal opacity-70">DRIFT</th>
            </tr>
          </thead>
          <tbody>
            {view.allocation.slices.map((slice) => (
              <tr key={slice.asset.symbol}>
                <th scope="row" className="pr-4 text-left font-normal">{slice.asset.symbol}</th>
                <td className="pr-4 text-right tabular-nums">
                  {formatUsd(slice.valueUsd)?.text ?? '—'}
                </td>
                <td className="pr-4 text-right tabular-nums">
                  {(slice.actualWeight * 100).toFixed(1)}%
                </td>
                <td className="pr-4 text-right tabular-nums">
                  {slice.targetWeight === null
                    ? '—'
                    : `${(slice.targetWeight * 100).toFixed(1)}%`}
                </td>
                <td className="text-right tabular-nums">
                  <Drift value={slice.driftPct} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="space-y-1">
        <h3 className="font-semibold">Rebalance plan</h3>
        <p className="opacity-80">{PLAN_STATUS_COPY[view.planStatus]}</p>
        {planned && view.plan.trades.length > 0 && (
          <ul>
            {view.plan.trades.map((trade) => (
              <li key={`${trade.asset.symbol}-${trade.side}`}>
                {trade.side.toUpperCase()} {trade.asset.symbol}{' '}
                {formatUsd(trade.amountUsd)?.text ?? trade.amountUsd}
                <span className="opacity-70"> · {trade.reason}</span>
              </li>
            ))}
          </ul>
        )}
        {/* estimateOnly is true on the wire; saying so is not decoration. */}
        <p className="opacity-70">
          Estimate only — turnover {formatUsd(view.plan.turnoverUsd)?.text ?? '—'}, max drift{' '}
          {view.plan.maxDriftPct.toFixed(1)}%. This build has no executor, and meeting the
          evidence gate would not add one.
        </p>
      </div>

      <DeferredPanel
        title="Contribution planner"
        phase="P8"
        reason="DCA and contribution planning need their own service before they can show a number worth acting on."
      />
    </section>
  );
}
