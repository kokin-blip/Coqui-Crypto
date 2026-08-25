import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { freshnessBadge } from '@coqui/ui-kit';

import { useChannel } from '../query/use-channel.js';
import { ProfileSwitcher } from './ProfileSwitcher.js';

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

function ExecutionPolicy({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const policy = useChannel(client, 'paper.execution.policy', {});
  if (policy.kind !== 'ready') return <span><strong>MODE UNKNOWN</strong></span>;
  const readOnly = policy.value.mode === 'off';
  return (
    <>
      <span><strong>{readOnly ? 'READ ONLY' : 'PAPER'}</strong></span>
      <span>review {policy.value.mode.replaceAll('_', ' ')}</span>
    </>
  );
}

export function StatusRail({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const rail = useChannel(client, 'app.status-rail', {});

  if (rail.kind === 'loading') {
    return (
      <header className="status-rail" aria-live="polite">
        <ProfileSwitcher client={client} />
        <span>Loading status…</span>
      </header>
    );
  }

  if (rail.kind !== 'ready') {
    // The rail failing is itself decision-critical: a user must not read a
    // blank rail as "nothing is wrong".
    return (
      <header className="status-rail" role="alert">
        <ProfileSwitcher client={client} />
        Status unavailable — {rail.issues.map((issue) => issue.code).join(', ')}. Treat mode,
        kill-switch and freshness as unknown.
      </header>
    );
  }

  const view = rail.value;

  return (
    <header className="status-rail">
      <ProfileSwitcher client={client} />

      <ExecutionPolicy client={client} />

      <span>
        Coinbase {view.reconciliation.neverRun ? 'not synced' : 'read only'}
      </span>

      {/* Sign plus word, never colour alone (§1). */}
      {/* Both halt sources feed this, and the rail says which one engaged —
          a manual safety stop used to display as "armed·off". */}
      <span>
        KILL{' '}
        <span className="font-semibold">
          {view.killSwitchEngaged ? 'ENGAGED' : 'armed·off'}
        </span>
        {view.killSwitchReason !== null && (
          <span className="opacity-80">
            {' '}
            ({view.killSwitchReason === 'safety_stop' ? 'safety stop' : 'risk hard stop'})
          </span>
        )}
      </span>

      <Freshness client={client} />

      <span>
        jobs: {view.activeJobCount === 0 ? 'idle' : `${view.activeJobCount} running`}
        {view.scheduledJobCount > 0 ? ` of ${view.scheduledJobCount}` : ''}
      </span>

      <span>{reconciliationText(view.reconciliation)}</span>

      <span>cost model {view.costModelBps}bps</span>

      <span>
        risk {view.riskStage ?? 'unknown'} · {view.executionPermitted ? 'paper permitted' : 'paper blocked'}
      </span>
    </header>
  );
}
