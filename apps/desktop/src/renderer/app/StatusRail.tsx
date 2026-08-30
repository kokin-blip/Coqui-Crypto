import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { StatusEmphasis } from '@coqui/ui-kit';
import { Activity, CircleDollarSign, Database, Radio, ShieldCheck } from 'lucide-react';

import { useChannel } from '../query/use-channel.js';
import { ProfileSwitcher } from './ProfileSwitcher.js';
import { CommandMenu } from './CommandMenu.js';

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
  const live = useChannel(client, 'market-data.live', {});
  if (live.kind !== 'ready') return <span className="rail-state"><Radio size={13} aria-hidden="true" /> Market feed unknown</span>;
  const state = live.value.connection;
  return (
    <span className={`rail-state rail-${state}`}>
      <Radio size={13} aria-hidden="true" /> Market feed {state}
      {live.value.lastMessageAtMs === null ? '' : ` · ${new Date(live.value.lastMessageAtMs).toISOString().slice(11, 16)}Z`}
    </span>
  );
}

function ExecutionPolicy({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const policy = useChannel(client, 'paper.execution.policy', {});
  if (policy.kind !== 'ready') return <span><strong>MODE UNKNOWN</strong></span>;
  const readOnly = policy.value.mode === 'off';
  return (
    <span className="rail-mode"><strong>{readOnly ? 'READ ONLY' : 'PAPER'}</strong><small>{policy.value.mode.replaceAll('_', ' ')}</small></span>
  );
}

function StrategyDecision({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const gate = useChannel(client, 'risk.evidence-gate', {});
  if (gate.kind !== 'ready') {
    return <span className="rail-strategy rail-warning"><small>Leading strategy</small><strong>Evidence unavailable</strong></span>;
  }
  return (
    <span className="rail-strategy rail-negative">
      <small>Leading strategy</small>
      <strong>{gate.value.facts?.leader ?? 'No eligible leader'} · not validated</strong>
      <span>{gate.value.status.replaceAll('_', ' ')}</span>
    </span>
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
      <div className="status-primary">
        <ProfileSwitcher client={client} />
        <ExecutionPolicy client={client} />
        <Freshness client={client} />
        <span className={`rail-decision ${view.reconciliation.unresolvedCount === 0 && !view.reconciliation.neverRun ? 'rail-positive' : 'rail-warning'}`}><Database size={14} aria-hidden="true" /><span><small>Reconciliation</small><strong>{view.reconciliation.neverRun ? 'Not run' : view.reconciliation.unresolvedCount === 0 ? 'Settled' : `${view.reconciliation.unresolvedCount} unresolved`}</strong></span></span>
        <StatusEmphasis stateKey={view.executionPermitted ? 'permitted' : 'blocked'}><span className={`rail-decision ${view.executionPermitted ? 'rail-positive' : 'rail-negative'}`}><ShieldCheck size={14} aria-hidden="true" /><span><small>Risk permission</small><strong>{view.executionPermitted ? 'Paper permitted' : 'Paper blocked'}</strong></span></span></StatusEmphasis>
        <StrategyDecision client={client} />
      </div>
      <div className="status-secondary">
        <span>Coinbase account {view.reconciliation.neverRun ? 'not synced' : 'read only'}</span>
        <span className={view.killSwitchEngaged ? 'rail-negative' : ''}>KILL <strong>{view.killSwitchEngaged ? 'ENGAGED' : 'armed · off'}</strong>{view.killSwitchReason === null ? '' : ` · ${view.killSwitchReason.replaceAll('_', ' ')}`}</span>
        <span><Activity size={12} aria-hidden="true" /> jobs {view.activeJobCount === 0 ? 'idle' : `${view.activeJobCount} running`}{view.scheduledJobCount > 0 ? ` / ${view.scheduledJobCount}` : ''}</span>
        <span>{reconciliationText(view.reconciliation)}</span>
        <span><CircleDollarSign size={12} aria-hidden="true" /> costs {view.costModelBps}bps</span>
        <span>risk stage {view.riskStage?.replaceAll('_', ' ') ?? 'unknown'}</span>
        <CommandMenu />
      </div>
    </header>
  );
}
