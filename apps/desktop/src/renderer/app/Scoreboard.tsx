import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { formatPercent, riskBadge, validationBadge } from '@coqui/ui-kit';

import { TrackTable } from './TrackTable.js';
import { useChannel, type ChannelState } from '../query/use-channel.js';

type GateView = ChannelResponse<'risk.evidence-gate'>;

/**
 * The strategy scoreboard's decision summary and gate.
 *
 * Implements the hierarchy in `docs/design/wireframes-2026-08-21.md`: the
 * unvalidated warning sits *above* the numbers, so a user who reads only the
 * top of the screen still leaves knowing the defaults are legacy. The gate
 * shows raw counts rather than a progress bar, which would imply a countdown
 * rather than a set of conditions.
 *
 * Visual styling is deliberately minimal pending the owner review that
 * `docs/UI-UX.md` §0 requires before the visual language propagates.
 */

const GATE_LABELS: Readonly<Record<GateView['gates'][number]['code'], string>> = {
  significance: 'clears deflated Sharpe',
  walk_forward: 'walk-forward adds value',
  beats_benchmarks: 'beats hold and passive',
  sample_size: 'sufficient sample',
};

const BLOCKED_REASONS: Readonly<Record<GateView['status'], string>> = {
  blocked_trial_history_incomplete:
    'The historical search budget is not usable, so deflated Sharpe cannot be computed.',
  blocked_no_verified_evidence: 'No verified evidence snapshot has been recorded yet.',
  blocked_invalid_evidence: 'A stored evidence snapshot failed content verification.',
  blocked_unsupported_evidence: 'A stored snapshot uses a format this build cannot read.',
  requirements_not_met: 'The evidence gate has not been met.',
  eligible_for_review: 'The gate conditions are met and the evidence is eligible for review.',
};

function Provenance({ gate }: { readonly gate: GateView }): React.JSX.Element {
  // ARCHITECTURE.md §9 makes provenance functional, and UI-UX §0 forbids
  // hiding it behind hover, so it renders inline.
  if (gate.source === null) return <p className="opacity-70">No provenance — no snapshot.</p>;
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-x-4 opacity-80">
      <dt>dataset</dt>
      <dd>{gate.source.datasetHash.slice(0, 12)}…</dd>
      <dt>trial registry</dt>
      <dd>{gate.source.trialRegistryHash.slice(0, 12)}…</dd>
      <dt>cost profile</dt>
      <dd>{gate.source.costProfileHash.slice(0, 12)}…</dd>
      <dt>pre-registration</dt>
      <dd>{gate.source.preRegistrationHash.slice(0, 12)}…</dd>
    </dl>
  );
}

function Leader({ gate }: { readonly gate: GateView }): React.JSX.Element {
  const { facts } = gate;
  // The trial count is a conservative upper bound, so the badge states the
  // direction rather than showing a bare DSR that would overstate the claim.
  const validation = validationBadge('upper-bound', 215);

  if (facts === null) {
    return (
      <p>
        No leader yet — {BLOCKED_REASONS[gate.status].toLowerCase()}
      </p>
    );
  }

  const excess =
    facts.leaderSortino !== null && facts.holdSortino !== null
      ? formatPercent((facts.leaderSortino - facts.holdSortino) * 100)
      : null;

  return (
    <div className="space-y-1">
      <p>
        <span className="font-semibold">LEADER</span> {facts.leader}
        {'  ·  '}
        {riskBadge(2).text}
      </p>
      <p className="opacity-80">
        sample {facts.sampleDays}d · Sortino {facts.leaderSortino?.toFixed(2) ?? '—'}
        {excess === null ? '' : ` · ${excess.text} vs hold`}
      </p>
      <p>
        DSR {facts.dsr === null ? 'unavailable' : facts.dsr.toFixed(2)}{' '}
        <span title={validation.label}>
          {validation.marker} {validation.text}
        </span>
      </p>
    </div>
  );
}

export function Scoreboard({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const gate: ChannelState<GateView> = useChannel(client, 'risk.evidence-gate', {});

  if (gate.kind === 'loading') return <p aria-live="polite">Loading evidence…</p>;

  if (gate.kind !== 'ready') {
    // Failure, blocked and unknown stay distinct: collapsing them would tell a
    // user that a guardrail refusal and a crashed provider are the same event.
    const heading =
      gate.kind === 'blocked'
        ? 'Blocked'
        : gate.kind === 'unknown'
          ? 'Outcome unconfirmed — do not retry'
          : 'Could not load the evidence gate';
    return (
      <p role="alert">
        {heading}: {gate.issues.map((issue) => issue.code).join(', ')}
      </p>
    );
  }

  const view = gate.value;
  const unvalidated = validationBadge('unvalidated', null);

  return (
    <section aria-labelledby="scoreboard-heading" className="space-y-6">
      <h2 id="scoreboard-heading" className="font-semibold">
        Strategy scoreboard
      </h2>

      {/*
        Above the numbers, not below. A caveat placed under the data lets the
        data be read first and the caveat never.
      */}
      <p role="note" className="border-l-2 pl-3">
        <span aria-hidden="true">{unvalidated.marker} </span>
        <span className="font-semibold">NOT VALIDATED</span> — {unvalidated.label}. Trading is
        blocked because the evidence gate is not met, not because of an error.
      </p>

      <Leader gate={view} />

      <TrackTable client={client} />

      <div>
        <h3 className="mb-1 font-semibold">Evidence gate</h3>
        <p className="mb-2 opacity-80">{BLOCKED_REASONS[view.status]}</p>
        {view.gates.length === 0 ? (
          <p className="opacity-70">No conditions assessed — there is nothing to assess yet.</p>
        ) : (
          <ul>
            {view.gates.map((condition) => (
              <li key={condition.code}>
                <span aria-hidden="true">{condition.met ? '✓' : '✗'}</span>{' '}
                <span className="sr-only">{condition.met ? 'met' : 'not met'}:</span>
                {GATE_LABELS[condition.code]}
              </li>
            ))}
          </ul>
        )}
        {/*
          Reaching the gate makes live considerable, never enabled. The wire
          type pins this to false; saying so here keeps the screen honest too.
        */}
        <p className="mt-2 opacity-70">
          Live execution is not available in this build, and meeting the gate would not enable it.
        </p>
      </div>

      <div>
        <h3 className="mb-1 font-semibold">Provenance</h3>
        <Provenance gate={view} />
      </div>
    </section>
  );
}
