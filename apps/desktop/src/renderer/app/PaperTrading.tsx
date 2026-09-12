import type { CoquiClient } from '@coqui/contracts';
import { presentAction } from '@coqui/ui-kit';

import { PaperProposalReview } from './PaperProposalReview.js';
import { Performance } from './Performance.js';
import { SurfaceState } from './SurfaceState.js';
import type { AppRoute } from './routes.js';
import { useChannel } from '../query/use-channel.js';
import { useCommand } from '../query/use-command.js';

const PREPARE_INVALIDATIONS = ['paper.execution.proposals', 'paper.execution.policy'] as const;

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export function PaperTrading({
  client,
  route,
}: {
  readonly client: CoquiClient;
  readonly route: AppRoute;
}): React.JSX.Element {
  const policy = useChannel(client, 'paper.execution.policy', {});
  const proposals = useChannel(client, 'paper.execution.proposals', { limit: 100 });
  const prepare = useCommand(client, 'paper.execution.prepare', PREPARE_INVALIDATIONS);
  const readiness = useChannel(client, 'app.profile-readiness', {});
  const presentation = presentAction(prepare.state, {
    idle: 'Prepare current rebalance', pending: 'Preparing proposal…',
  }, 'consequential');

  if (route === 'paper/performance') {
    return <Performance client={client} />;
  }

  const rows = proposals.kind === 'ready' ? proposals.value.proposals : [];
  const unmet = readiness.kind === 'ready' ? readiness.value.steps.slice(0, 5).find((step) => step.status !== 'complete') : undefined;
  return (
    <div className="screen-stack">
      <section className="paper-control-panel">
        <div>
          <p className="eyebrow">Execution policy</p>
          <h2>{policy.kind === 'ready' ? statusLabel(policy.value.mode) : 'policy unavailable'}</h2>
          <p className="muted">System-generated rebalances only. Every submission reruns all gates.</p>
        </div>
        {route === 'paper/overview' && (
          <button
            type="button"
            className="button-primary"
            disabled={presentation.disabled || unmet !== undefined}
            aria-busy={presentation.busy}
            onClick={() => void prepare.run({ commandId: crypto.randomUUID() })}
          >
            {presentation.label}
          </button>
        )}
      </section>

      {route === 'paper/overview' && unmet !== undefined && <SurfaceState kind="blocked" title="Paper preparation is not ready" detail={unmet.detail} action={{ label: unmet.actionLabel, href: unmet.route }} />}

      {prepare.value !== null && (
        <p className={`execution-outcome outcome-${prepare.value.status}`} role="status">
          {prepare.value.status.toUpperCase()} ·{' '}
          {prepare.value.reasonCode?.replaceAll('_', ' ') ?? 'proposal settled'}
        </p>
      )}

      <section aria-labelledby="proposal-heading" className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Durable queue</p><h2 id="proposal-heading">Paper proposals</h2></div>
          <span className="muted">{rows.length} recorded</span>
        </div>
        {proposals.kind === 'loading' && <SurfaceState kind="loading" title="Loading proposals" compact />}
        {proposals.kind !== 'loading' && proposals.kind !== 'ready' && (
          <SurfaceState kind="error" title="Could not load proposals" detail={proposals.issues.map((issue) => issue.code).join(', ')} compact />
        )}
        {proposals.kind === 'ready' && rows.length === 0 && (
          <SurfaceState kind="empty" title="No paper proposal has been prepared for this profile." compact />
        )}
        {rows.length > 0 && (
          <ul className="proposal-list">
            {rows.map((proposal) => (
              <li key={proposal.id}>
                <div>
                  <strong>{proposal.actions.length} rebalance action{proposal.actions.length === 1 ? '' : 's'}</strong>
                  <span className="muted">revision {proposal.revision} · {proposal.proposalHash.slice(0, 12)}…</span>
                  {proposal.actions.length>0&&<span className="proposal-route-summary">{proposal.actions.map((action)=>
                    `${action.side.toUpperCase()} ${action.productId} · ${action.amountUsd} USD`).join('  |  ')}</span>}
                </div>
                <span className={`status-text status-${proposal.status}`}>{statusLabel(proposal.status)}</span>
                {proposal.status === 'pending_review' && (
                  <PaperProposalReview client={client} proposal={proposal} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
