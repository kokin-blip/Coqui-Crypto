import type { CoquiClient } from '@coqui/contracts';
import { Check, Circle } from 'lucide-react';

import { useChannel } from '../query/use-channel.js';
import { SurfaceState } from './SurfaceState.js';
import { exactUtcTimestamp, formatLocalTimestamp } from './time-format.js';

export function ReadinessGuide({ client }: { readonly client: CoquiClient }): React.JSX.Element | null {
  const readiness = useChannel(client, 'app.profile-readiness', {});
  const status = useChannel(client, 'app.status-rail', {});
  const activity = useChannel(client, 'activity.feed', { limit: 1, cursor: null });
  if (readiness.kind === 'loading') return <SurfaceState kind="loading" title="Checking setup readiness" compact />;
  if (readiness.kind !== 'ready') return <SurfaceState kind="error" title="Readiness unavailable" detail="Coqui could not verify the current setup state." compact />;
  if (readiness.value.firstDecisionComplete) return null;
  const current = readiness.value.steps.find((step) => step.status === 'current' || step.status === 'blocked');
  const lastEvent = activity.kind === 'ready' ? activity.value.events[0] : undefined;
  const hostTask = status.kind !== 'ready' ? 'Host status unavailable' : status.value.activeJobCount > 0
    ? `${status.value.activeJobCount} host task${status.value.activeJobCount === 1 ? '' : 's'} running`
    : status.value.scheduledJobCount > 0 ? 'Waiting for the next scheduled task' : 'No host task is scheduled';
  const complete = readiness.value.steps.filter((step) => step.status === 'complete').length;
  return <section className="readiness-guide" aria-labelledby="readiness-title">
    <div className="readiness-summary">
      <div><p className="section-label">Setup · {complete} of {readiness.value.steps.length} complete</p>
        <h2 id="readiness-title">{current?.title ?? 'Review your first decision'}</h2>
        <p>{current?.detail ?? 'The next paper decision is ready to inspect.'}</p></div>
      {current !== undefined && <a className="button-primary readiness-action" href={current.route}>{current.actionLabel}</a>}
    </div>
    <details className="readiness-details"><summary>View setup steps and host activity</summary>
      <ol>{readiness.value.steps.map((step) => <li key={step.id} className={`readiness-${step.status}`}>
        {step.status === 'complete' ? <Check size={16} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
        <span><strong>{step.title}</strong><small>{step.detail}</small></span>
      </li>)}</ol>
      <section className="readiness-now" aria-label="Host activity and evidence">
        <div><p className="section-label">Host activity</p><h3>{hostTask}</h3></div>
        <dl><div><dt>Last completed action</dt><dd>{lastEvent === undefined ? 'No durable action recorded yet' : <>{lastEvent.title}<small><time dateTime={exactUtcTimestamp(lastEvent.occurredAt)} title={exactUtcTimestamp(lastEvent.occurredAt)}>{formatLocalTimestamp(lastEvent.occurredAt)}</time></small></>}</dd></div>
          <div><dt>Current blocker</dt><dd>{current?.detail ?? 'No readiness blocker recorded'}</dd></div>
          <div><dt>Next action</dt><dd>{current?.actionLabel ?? 'Inspect the latest decision evidence'}</dd></div></dl>
        {lastEvent?.decisionId !== null && lastEvent?.decisionId !== undefined && <a className="button-secondary" href="#/activity">Open latest evidence</a>}
      </section>
    </details>
  </section>;
}
