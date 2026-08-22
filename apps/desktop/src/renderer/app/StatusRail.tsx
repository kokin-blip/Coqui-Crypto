import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { freshnessBadge } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';

type RailView = ChannelResponse<'app.status-rail'>;

/**
 * The global status rail (`docs/UI-UX.md` §2.1), reused verbatim by every
 * screen. It carries the decision-critical state §1 requires to stay
 * continuously visible: wallet, mode, kill switch, market-data freshness,
 * background jobs, reconciliation, and the cost model.
 *
 * Market-data freshness comes from the prices channel the app already polls
 * rather than from a second fetch — the provenance it returns is exactly the
 * freshness the rail needs to show.
 */

function reconciliationText(reconciliation: RailView['reconciliation']): string {
  if (reconciliation.neverRun) return 'reconcile never run';

  const at = new Date(reconciliation.lastRunAtMs ?? 0)
    .toISOString()
    .slice(11, 16);

  // Reporting only the timestamp would answer the rail's own question — "is
  // anything wrong right now?" — with "no" while exceptions sit unresolved.
  return reconciliation.unresolvedCount === 0
    ? `reconcile ${at}Z · settled`
    : `reconcile ${at}Z · ${reconciliation.unresolvedCount} unresolved`;
}

function Freshness({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const prices = useChannel(client, 'market-data.prices', {});
  if (prices.kind !== 'ready') return <span>data —</span>;

  const badge = freshnessBadge(
    prices.value.provenance.freshness,
    prices.value.provenance.ageMs,
  );
  return (
    <span title={badge.label}>
      data {badge.text} <span aria-hidden="true">{badge.marker}</span>
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}

export function StatusRail({
  client,
  profileId,
}: {
  readonly client: CoquiClient;
  readonly profileId: string;
}): React.JSX.Element {
  const rail = useChannel(client, 'app.status-rail', { profileId });

  if (rail.kind === 'loading') {
    return (
      <header className="border-b pb-2 opacity-70" aria-live="polite">
        Loading status…
      </header>
    );
  }

  if (rail.kind !== 'ready') {
    // The rail failing is itself decision-critical: a user must not read a
    // blank rail as "nothing is wrong".
    return (
      <header className="border-b pb-2" role="alert">
        Status unavailable — {rail.issues.map((issue) => issue.code).join(', ')}. Treat mode,
        kill-switch and freshness as unknown.
      </header>
    );
  }

  const view = rail.value;

  return (
    <header className="flex flex-wrap gap-x-6 gap-y-1 border-b pb-2">
      <span>wallet: {view.profileId}</span>

      <span>
        MODE <span className="font-semibold">{view.mode}</span>
      </span>

      {/* Sign plus word, never colour alone (§1). */}
      <span>
        KILL{' '}
        <span className="font-semibold">
          {view.killSwitchEngaged ? 'ENGAGED' : 'armed·off'}
        </span>
      </span>

      <Freshness client={client} />

      <span>
        jobs: {view.activeJobCount === 0 ? 'idle' : `${view.activeJobCount} running`}
        {view.scheduledJobCount > 0 ? ` of ${view.scheduledJobCount}` : ''}
      </span>

      <span>{reconciliationText(view.reconciliation)}</span>

      <span>cost model {view.costModelBps}bps</span>

      {view.riskStage !== null && <span>risk {view.riskStage}</span>}
    </header>
  );
}
