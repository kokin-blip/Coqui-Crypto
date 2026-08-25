import type { CoquiClient } from '@coqui/contracts';

import { NegativeFindings } from './NegativeFindings.js';
import { ResearchRuns } from './ResearchRuns.js';
import { useChannel } from '../query/use-channel.js';

export function Research({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const jobs = useChannel(client, 'research.jobs', { limit: 50 });
  const performance = useChannel(client, 'research.performance', {});
  return (
    <div className="screen-stack">
      <ResearchRuns client={client} />
      <section className="panel" aria-labelledby="research-jobs-heading">
        <div className="panel-heading"><div><p className="eyebrow">Durable worker queue</p><h2 id="research-jobs-heading">Research jobs</h2></div></div>
        {jobs.kind === 'loading' && <p aria-live="polite">Loading research jobs…</p>}
        {jobs.kind === 'ready' && jobs.value.length === 0 && <p className="empty-copy">No registered research job has run for this profile.</p>}
        {jobs.kind === 'ready' && jobs.value.length > 0 && <ul className="evidence-list">{jobs.value.map((job) => <li key={job.id}><span><strong>{job.kind}</strong> · {job.status}</span><span className="muted">attempts {job.attemptCount} · {job.failureReason.replaceAll('_', ' ')}</span></li>)}</ul>}
        {jobs.kind !== 'loading' && jobs.kind !== 'ready' && <p role="alert">Research jobs unavailable: {jobs.issues.map((issue) => issue.code).join(', ')}</p>}
      </section>
      <section className="panel" aria-labelledby="research-curves-heading">
        <div className="panel-heading"><div><p className="eyebrow">Immutable artifact inspection</p><h2 id="research-curves-heading">Recorded strategy curves</h2></div></div>
        {performance.kind === 'loading' && <p aria-live="polite">Inspecting artifacts…</p>}
        {performance.kind === 'ready' && performance.value.length === 0 && <p className="empty-copy">No immutable study artifact exists.</p>}
        {performance.kind === 'ready' && performance.value.length > 0 && <ul className="evidence-list">{performance.value.map((run) => <li key={run.runHash}><span><strong>{run.runId}</strong> · {run.status === 'available' ? `${run.curve.length} recorded points` : 'curve unavailable—not recorded'}</span><span className="muted">dataset {run.datasetHash.slice(0, 12)}… · run {run.runHash.slice(0, 12)}…</span></li>)}</ul>}
        {performance.kind !== 'loading' && performance.kind !== 'ready' && <p role="alert">Artifact inspection unavailable: {performance.issues.map((issue) => issue.code).join(', ')}</p>}
      </section>
      <NegativeFindings client={client} />
    </div>
  );
}
