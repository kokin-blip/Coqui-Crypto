import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';

type PaperView = ChannelResponse<'paper.portfolio'>;

/**
 * What the strategy *would* be worth, beside what you actually hold.
 *
 * There is no paper screen and no paper console. The engine is scheduler-driven,
 * so there is no user-initiated order to preview or confirm, and a separate
 * screen would imply an interaction that does not exist. Paper is a comparison
 * the user reads.
 *
 * The paper figure is labelled a **simulation** every time it appears. It is
 * never formatted as plain money beside the real number without that word,
 * because the whole risk of showing the two together is that one is mistaken
 * for the other.
 */

const STAND_DOWN_COPY: Record<string, string> = {
  kill_switch_engaged: 'the kill switch is engaged, so the engine placed nothing',
  no_policy: 'no allocation policy is set, so there was nothing to rebalance towards',
  no_intents: 'holdings were already within the rebalance band, so no trade was needed',
  gates_refused: 'the guardrails refused every proposed trade',
};

const REQUIREMENT_COPY: Record<string, string> = {
  observed_days: 'days observed',
  decisions: 'decisions',
  fills: 'fills',
};

function day(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10);
}

function Difference({
  actual,
  paper,
}: {
  readonly actual: string | null;
  readonly paper: string | null;
}): React.JSX.Element | null {
  // Both sides must be known. A difference against an incomplete total would
  // read as strategy performance when it is really a missing price.
  if (actual === null || paper === null) return null;
  const delta = Number(paper) - Number(actual);
  if (!Number.isFinite(delta)) return null;
  const formatted = formatUsd(delta.toFixed(2), { signed: true });
  if (formatted === null) return null;
  return (
    <span className="ml-4 tabular-nums">
      <span aria-hidden="true">{formatted.figure.marker} </span>
      {formatted.text}
      <span className="sr-only"> difference, simulated minus actual</span>
    </span>
  );
}

function Evidence({ evidence }: { readonly evidence: PaperView['evidence'] }): React.JSX.Element {
  return (
    <p className="opacity-70">
      {evidence.requirements.map((requirement, index) => (
        <span key={requirement.code}>
          {index > 0 && ' · '}
          <span aria-hidden="true">{requirement.met ? '●' : '○'} </span>
          {requirement.observed} of {requirement.required}{' '}
          {REQUIREMENT_COPY[requirement.code] ?? requirement.code}
        </span>
      ))}
    </p>
  );
}

export function PaperComparison({
  client,
  profileId,
  actualTotalUsd,
}: {
  readonly client: CoquiClient;
  readonly profileId: string;
  /** The real portfolio total, or null when it is only a priced subtotal. */
  readonly actualTotalUsd: string | null;
}): React.JSX.Element | null {
  const paper = useChannel(client, 'paper.portfolio', { profileId });

  // A failure here must not disturb the real portfolio above it, so the
  // comparison simply does not appear.
  if (paper.kind !== 'ready') return null;
  const view = paper.value;

  // Nothing has run yet. Claiming a $0 simulation would be a claim.
  if (view.startedAtMs === null && view.lastRun === null) {
    return (
      <p role="note" className="border-l-2 pl-3 opacity-70">
        The paper engine has not run yet — there is no simulated value to compare.
      </p>
    );
  }

  const paperTotal =
    view.totalValueUsd === null ? null : (formatUsd(view.totalValueUsd)?.text ?? null);

  return (
    <section aria-labelledby="paper-heading" className="space-y-1 border-l-2 pl-3">
      <h3 id="paper-heading" className="font-semibold">
        POSSIBLE (PAPER) VALUE{' '}
        <span className="font-normal opacity-70">— simulation, not money</span>
      </h3>
      <p className="text-base tabular-nums">
        {paperTotal ?? <span title="a simulated position could not be priced">—</span>}
        <Difference actual={actualTotalUsd} paper={view.totalValueUsd} />
      </p>
      {view.unpricedCount > 0 && (
        <p role="note">
          <span aria-hidden="true">⚠ </span>
          {view.unpricedCount} simulated position{view.unpricedCount === 1 ? '' : 's'} unpriced —
          no simulated total is shown rather than an understated one.
        </p>
      )}
      {view.startedAtMs !== null && (
        <p className="opacity-70">paper started {day(view.startedAtMs)}</p>
      )}
      <Evidence evidence={view.evidence} />
      {view.lastRun !== null && (
        <p>
          last run {day(view.lastRun.scheduledForMs)}:{' '}
          {view.lastRun.standDown === null
            ? `${view.lastRun.filled} filled, ${view.lastRun.refused} refused`
            : (STAND_DOWN_COPY[view.lastRun.standDown] ?? view.lastRun.standDown)}
          .
        </p>
      )}
      <p className="opacity-70">
        Meeting the evidence bar makes live trading <em>considerable</em>, never enabled. This
        build has no order-submission path.
      </p>
    </section>
  );
}
