import { useRef, useState } from 'react';

import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatUsd, presentAction } from '@coqui/ui-kit';

import { useCommand } from '../query/use-command.js';

type Proposal = ChannelResponse<'paper.execution.proposal'>;
const INVALIDATIONS = [
  'paper.execution.proposals', 'paper.execution.proposal',
  'paper.portfolio', 'app.status-rail',
] as const;

function outcomeCopy(status: string, reason: string | null): string {
  if (status === 'succeeded') return 'Paper submission confirmed.';
  if (status === 'pending') return 'Waiting for human review.';
  if (status === 'unknown') return 'Outcome unknown. Do not retry; reconcile first.';
  if (status === 'blocked') return `Blocked${reason === null ? '' : `: ${reason.replaceAll('_', ' ')}`}.`;
  return `Failed${reason === null ? '' : `: ${reason.replaceAll('_', ' ')}`}.`;
}

export function PaperProposalReview({
  client,
  proposal,
}: {
  readonly client: CoquiClient;
  readonly proposal: Proposal;
}): React.JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const command = useCommand(client, 'paper.execution.review', INVALIDATIONS);
  const presentation = presentAction(command.state, {
    idle: 'Confirm paper submission', pending: 'Rechecking every gate…',
  }, 'consequential');

  const review = (decision: 'approve' | 'reject'): void => {
    void command.run({
      commandId: crypto.randomUUID(),
      proposalId: proposal.id,
      proposalHash: proposal.proposalHash,
      decision,
      reviewer: 'profile owner',
      note: note.trim(),
    });
  };

  return (
    <>
      <button
        type="button"
        className="button-secondary"
        onClick={() => dialog.current?.showModal()}
      >
        Review proposal
      </button>
      <dialog ref={dialog} className="review-dialog" aria-labelledby={`review-${proposal.id}`}>
        <form method="dialog" className="review-dialog-content">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">Human review · revision {proposal.revision}</p>
              <h2 id={`review-${proposal.id}`}>Paper action proposal</h2>
            </div>
            <button className="button-quiet" value="cancel" aria-label="Close review">Close</button>
          </div>

          <p className="review-hash">Bound to proposal {proposal.proposalHash.slice(0, 16)}…</p>
          <ul className="proposal-actions">
            {proposal.actions.map((action) => (
              <li key={`${action.productId}:${action.side}`}>
                <strong>{action.side.toUpperCase()} {action.productId}</strong>
                <span>{formatUsd(action.amountUsd)?.text ?? action.amountUsd} paper notional</span>
              </li>
            ))}
          </ul>

          <ol className="gate-chain" aria-label="Submission gate chain">
            <li><strong>Profitability</strong><span>Recomputed with the shared cost model</span></li>
            <li><strong>Evidence</strong><span>Verified immutable snapshot required</span></li>
            <li><strong>Risk controls</strong><span>Recomputed from fresh portfolio state</span></li>
            <li><strong>Paper permission</strong><span>Live execution remains unavailable</span></li>
            <li><strong>Kill switch</strong><span>Checked again at submission</span></li>
          </ol>

          <label className="review-note">
            Review note
            <textarea
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Record what you reviewed"
            />
          </label>

          {command.value !== null && (
            <p className={`execution-outcome outcome-${command.value.status}`} role="status">
              {outcomeCopy(command.value.status, command.value.reasonCode)}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button-secondary"
              disabled={presentation.disabled}
              onClick={() => review('reject')}
            >
              Reject proposal
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={presentation.disabled || note.trim().length === 0}
              aria-busy={presentation.busy}
              onClick={() => review('approve')}
            >
              {presentation.label}
            </button>
          </div>
          <span className="sr-only" aria-live="polite">{presentation.liveMessage}</span>
        </form>
      </dialog>
    </>
  );
}
