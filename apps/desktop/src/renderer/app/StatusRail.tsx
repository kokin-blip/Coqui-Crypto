import type { ChannelResponse, CoquiClient } from '@coqui/contracts';
import { StatusEmphasis } from '@coqui/ui-kit';
import { Activity, Bell, CircleDollarSign, Database, Radio, ShieldCheck, UserRound } from 'lucide-react';

import { useChannel } from '../query/use-channel.js';
import { ProfileSwitcher } from './ProfileSwitcher.js';
import { CommandMenu } from './CommandMenu.js';
import { statusSummary } from './workspace-layout.js';
import { formatLocalTime } from './time-format.js';

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

  const at = formatLocalTime(reconciliation.lastRunAtMs ?? 0);

  // Reporting only the timestamp would answer the rail's own question — "is
  // anything wrong right now?" — with "no" while exceptions sit unresolved.
  return reconciliation.unresolvedCount === 0
    ? `reconcile ${at} · settled`
    : `reconcile ${at} · ${reconciliation.unresolvedCount} unresolved`;
}

function Freshness({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const live = useChannel(client, 'market-data.live', {});
  if (live.kind !== 'ready') return <span className="rail-state"><Radio size={13} aria-hidden="true" /> Market feed unknown</span>;
  const state = live.value.connection;
  return (
    <span className={`rail-state rail-${state}`} aria-label={`Market feed ${state}`} title={`Market feed ${state}`}>
      <Radio size={13} aria-hidden="true" /> Market feed {state}
      {live.value.lastMessageAtMs === null ? '' : ` · ${formatLocalTime(live.value.lastMessageAtMs)}`}
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

function NotificationCenter({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const alerts = useChannel(client, 'alerts.view', {});
  const activity = useChannel(client, 'activity.feed', { limit: 12, cursor: null });
  const alertItems = alerts.kind === 'ready' ? alerts.value.alerts.filter((item) => item.readAt === null)
    .map((item) => ({ id: item.id, title: item.reasonCode.replaceAll('_', ' '), at: item.occurredAt })) : [];
  const operationItems = activity.kind === 'ready' ? activity.value.events
    .filter((item) => item.status === 'failed' || item.status === 'blocked' ||
      ['fill', 'research', 'host'].includes(item.kind))
    .map((item) => ({ id: item.id, title: item.title, at: item.occurredAt })) : [];
  const items = [...alertItems, ...operationItems].sort((a, b) => b.at - a.at).slice(0, 6);
  return <details className="status-details notification-center">
    <summary aria-label={`Open notifications, ${items.length} recent`} title="Notifications"><Bell size={14} aria-hidden="true" />
      <span>Notifications</span>{items.length > 0 && <strong>{items.length}</strong>}</summary>
    <div className="status-details-panel">
      {items.length === 0 ? <span>No unread or actionable evidence</span> : items.map((item) =>
        <a key={item.id} href="#/activity"><span>{item.title}</span><small>{formatLocalTime(item.at)}</small></a>)}
      <a href="#/activity">Open all operational evidence</a>
    </div>
  </details>;
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
  const summary = statusSummary(view);

  return (
    <header className="status-rail">
      <div className="status-primary">
        <div className="profile-status-module"><UserRound size={17} aria-hidden="true" /><ProfileSwitcher client={client} compact /><ExecutionPolicy client={client} /></div>
        <Freshness client={client} />
        <StatusEmphasis stateKey={`${summary.tone}:${summary.text}`}><span className={`rail-decision rail-${summary.tone}`}><ShieldCheck size={14} aria-hidden="true" /><span><small>Safety</small><strong>{summary.text}</strong></span></span></StatusEmphasis>
        <details className="status-details">
          <summary aria-label={`Reconciliation status: ${reconciliationText(view.reconciliation)}. Open system status`} title="System status"><Database size={14} aria-hidden="true" /> <span className="rail-reconciliation">{reconciliationText(view.reconciliation)}</span><span className="rail-reconciliation-short">{view.reconciliation.neverRun ? 'Not reconciled' : view.reconciliation.unresolvedCount === 0 ? 'Reconciled' : `${view.reconciliation.unresolvedCount} unresolved`}</span></summary>
          <div className="status-details-panel">
            <StrategyDecision client={client} />
            <span><Database size={13} aria-hidden="true" /> {reconciliationText(view.reconciliation)}</span>
            <span><Activity size={13} aria-hidden="true" /> {view.activeJobCount} active / {view.scheduledJobCount} scheduled</span>
            <span><CircleDollarSign size={13} aria-hidden="true" /> cost model {view.costModelBps} bps</span>
            <span><ShieldCheck size={13} aria-hidden="true" /> risk stage {view.riskStage ?? 'unassessed'}</span>
          </div>
        </details>
        <NotificationCenter client={client} />
        <CommandMenu />
      </div>
    </header>
  );
}
