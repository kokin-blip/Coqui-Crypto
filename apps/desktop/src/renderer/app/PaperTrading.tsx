import type { CoquiClient } from '@coqui/contracts';
import { formatUsd, presentAction } from '@coqui/ui-kit';

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

function percent(value: number | null): string {
  return value === null ? 'Unavailable' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
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
  const exploratory = useChannel(client, 'paper.exploratory.status', {});
  const exploratoryPortfolio = useChannel(client, 'paper.exploratory.portfolio', {});
  const evaluate = useCommand(client, 'paper.exploratory.evaluate-now', [
    'paper.exploratory.portfolio', 'paper.exploratory.performance',
    'paper.execution.proposals', 'activity.feed', 'operations.floor',
  ]);
  const exploratoryActive = exploratory.kind === 'ready' && exploratory.value?.status === 'active';
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
          <h2>{exploratoryActive ? 'Exploratory · unattended paper' : policy.kind === 'ready' ? statusLabel(policy.value.mode) : 'policy unavailable'}</h2>
          <p className="muted">{exploratoryActive
            ? 'Current TrendVol strategy · unvalidated · Coinbase reference simulation · no live authority.'
            : 'System-generated rebalances only. Every submission reruns all gates.'}</p>
        </div>
        {route === 'paper/overview' && (
          <button
            type="button"
            className="button-primary"
            disabled={exploratoryActive ? evaluate.state.kind === 'pending' : presentation.disabled || unmet !== undefined}
            aria-busy={exploratoryActive ? evaluate.state.kind === 'pending' : presentation.busy}
            onClick={() => exploratoryActive
              ? void evaluate.run({ commandId: crypto.randomUUID() })
              : void prepare.run({ commandId: crypto.randomUUID() })}
          >
            {exploratoryActive
              ? evaluate.state.kind === 'pending' ? 'Evaluating current completed bar…' : 'Evaluate exploratory strategy now'
              : presentation.label}
          </button>
        )}
      </section>

      {route === 'paper/overview' && unmet !== undefined && !exploratoryActive && <SurfaceState kind="blocked" title="Paper preparation is not ready" detail={unmet.detail} action={{ label: unmet.actionLabel, href: unmet.route }} />}

      {exploratoryPortfolio.kind === 'ready' && exploratoryPortfolio.value !== null && exploratoryPortfolio.value.primary && (
        <section className="panel exploratory-paper-summary" aria-labelledby="exploratory-summary-heading">
          <div className="panel-heading"><div><span className="status-chip status-warning">Paper simulation</span><h2 id="exploratory-summary-heading">Exploratory campaign</h2></div><strong>{exploratoryPortfolio.value.valuationStatus === 'complete' && exploratoryPortfolio.value.currentEquityUsd !== null ? formatUsd(exploratoryPortfolio.value.currentEquityUsd)?.text : 'Valuation unavailable'}</strong></div>
          <dl className="settings-readout exploratory-paper-metrics">
            <div><dt>Opening reference</dt><dd>{formatUsd(exploratoryPortfolio.value.openingEquityUsd)?.text}</dd></div>
            <div><dt>Buy-and-hold</dt><dd>{exploratoryPortfolio.value.buyAndHoldBenchmarkUsd === null ? 'Unavailable' : formatUsd(exploratoryPortfolio.value.buyAndHoldBenchmarkUsd)?.text}</dd></div>
            <div><dt>Paper return</dt><dd>{percent(exploratoryPortfolio.value.paperReturnPct)}</dd></div>
            <div><dt>Vs. opening buy-and-hold</dt><dd>{percent(exploratoryPortfolio.value.benchmarkDifferencePct)}</dd></div>
            <div><dt>Recorded drawdown</dt><dd>{percent(exploratoryPortfolio.value.drawdownPct)}</dd></div>
            <div><dt>Estimated costs</dt><dd>{formatUsd(exploratoryPortfolio.value.estimatedCostsUsd)?.text}</dd></div>
            <div><dt>Orders</dt><dd>{exploratoryPortfolio.value.counts.submitted} submitted · {exploratoryPortfolio.value.counts.filled} filled · {exploratoryPortfolio.value.counts.pending} pending</dd></div>
            <div><dt>Other outcomes</dt><dd>{exploratoryPortfolio.value.counts.expired} expired · {exploratoryPortfolio.value.counts.refused} refused · {exploratoryPortfolio.value.counts.noTrade} no-trade</dd></div>
          </dl>
          <p className="muted">{exploratoryPortfolio.value.balances.filter((item) => item.managed).length} managed · {exploratoryPortfolio.value.balances.filter((item) => !item.managed && item.exposureKey !== 'USD').length} reference-only · simulation venue: {exploratoryPortfolio.value.simulationVenue}</p>
        </section>
      )}

      {prepare.value !== null && (
        <p className={`execution-outcome outcome-${prepare.value.status}`} role="status">
          {prepare.value.status.toUpperCase()} ·{' '}
          {prepare.value.reasonCode?.replaceAll('_', ' ') ?? 'proposal settled'}
        </p>
      )}
      {evaluate.value !== null && <p className="execution-outcome" role="status">
        {evaluate.value.standDown === null ? 'EVALUATED' : evaluate.value.standDown.replaceAll('_', ' ').toUpperCase()} · {evaluate.value.submittedCount} submitted · {evaluate.value.filledCount} filled
      </p>}
      {evaluate.state.kind === 'failed' && <p className="execution-outcome outcome-failed" role="alert">
        FAILED · {evaluate.state.codes.join(', ').replaceAll('_', ' ')}
      </p>}
      {evaluate.state.kind === 'blocked' && <p className="execution-outcome outcome-blocked" role="alert">
        BLOCKED · {evaluate.state.codes.join(', ').replaceAll('_', ' ')}
      </p>}
      {evaluate.state.kind === 'unknown' && <p className="execution-outcome outcome-unknown" role="alert">
        UNKNOWN · {evaluate.state.codes.join(', ').replaceAll('_', ' ')}
      </p>}

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
