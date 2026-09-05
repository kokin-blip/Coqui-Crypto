import type { CoquiClient } from '@coqui/contracts';

import { NegativeFindings } from './NegativeFindings.js';
import { ResearchRuns } from './ResearchRuns.js';
import { SurfaceState } from './SurfaceState.js';
import { useChannel } from '../query/use-channel.js';

export function Research({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const jobs = useChannel(client, 'research.jobs', { limit: 50 });
  const performance = useChannel(client, 'research.performance', {});
  const edgeStudy = useChannel(client, 'research.edge-study', {});
  return (
    <div className="screen-stack">
      <ResearchRuns client={client} />
      <section className="panel" aria-labelledby="forward-edge-heading">
        <div className="panel-heading"><div><p className="eyebrow">Prospective evidence only</p><h2 id="forward-edge-heading">Forward edge study</h2></div></div>
        {edgeStudy.kind === 'loading' && <SurfaceState kind="loading" title="Reading the registered study" compact />}
        {edgeStudy.kind === 'ready' && <>
          <p><strong>{edgeStudy.value.status.replaceAll('_', ' ')}</strong> · {edgeStudy.value.completedDays}/365 completed forward days · {edgeStudy.value.costBearingRebalances}/30 cost-bearing rebalances.</p>
          <p className="muted">No historical backfill or parameter reselection. Registered trial upper bound: {edgeStudy.value.trialUpperBound}. Activation: {edgeStudy.value.activated ? 'integrity-verified passing result active' : 'none—execution edge remains zero'}.</p>
          {edgeStudy.value.grossEdgeLowerBoundPct !== null && <p>Gross lower bound {edgeStudy.value.grossEdgeLowerBoundPct.toFixed(3)}% · current costs applied once · net lower bound {edgeStudy.value.netEdgeLowerBoundPct?.toFixed(3) ?? 'unavailable'}%</p>}
          {edgeStudy.value.planHash !== null && <p className="mono muted">plan {edgeStudy.value.planHash.slice(0, 16)}… · costs {edgeStudy.value.costProfileHash?.slice(0, 16)}…{edgeStudy.value.resultHash === null ? '' : ` · result ${edgeStudy.value.resultHash.slice(0, 16)}… · ${edgeStudy.value.sourceHashes.length} source hashes`}</p>}
        </>}
        {edgeStudy.kind !== 'loading' && edgeStudy.kind !== 'ready' && <SurfaceState kind="error" title="Forward study unavailable" detail={edgeStudy.issues.map((issue) => issue.code).join(', ')} compact />}
      </section>
      <section className="panel" aria-labelledby="research-jobs-heading">
        <div className="panel-heading"><div><p className="eyebrow">Durable worker queue</p><h2 id="research-jobs-heading">Research jobs</h2></div></div>
        {jobs.kind === 'loading' && <SurfaceState kind="loading" title="Loading research jobs" compact />}
        {jobs.kind === 'ready' && jobs.value.length === 0 && <SurfaceState kind="empty" title="No registered research job has run for this profile." compact />}
        {jobs.kind === 'ready' && jobs.value.length > 0 && <ul className="evidence-list">{jobs.value.map((job) => <li key={job.id}><span><strong>{job.kind}</strong> · {job.status}</span><span className="muted">attempts {job.attemptCount} · {job.failureReason.replaceAll('_', ' ')}</span></li>)}</ul>}
        {jobs.kind !== 'loading' && jobs.kind !== 'ready' && <SurfaceState kind="error" title="Research jobs unavailable" detail={jobs.issues.map((issue) => issue.code).join(', ')} compact />}
      </section>
      <section className="panel" aria-labelledby="research-curves-heading">
        <div className="panel-heading"><div><p className="eyebrow">Immutable artifact inspection</p><h2 id="research-curves-heading">Recorded strategy curves</h2></div></div>
        {performance.kind === 'loading' && <SurfaceState kind="loading" title="Inspecting artifacts" compact />}
        {performance.kind === 'ready' && performance.value.length === 0 && <SurfaceState kind="empty" title="No immutable study artifact exists." compact />}
        {performance.kind === 'ready' && performance.value.length > 0 && <ul className="evidence-list">{performance.value.map((run) => <li key={run.runHash}><span><strong>{run.runId}</strong> · {run.status === 'available' ? `${run.curve.length} recorded points` : 'curve unavailable—not recorded'}</span><span className="muted">dataset {run.datasetHash.slice(0, 12)}… · run {run.runHash.slice(0, 12)}…</span></li>)}</ul>}
        {performance.kind !== 'loading' && performance.kind !== 'ready' && <SurfaceState kind="error" title="Artifact inspection unavailable" detail={performance.issues.map((issue) => issue.code).join(', ')} compact />}
      </section>
      <NegativeFindings client={client} />
    </div>
  );
}
