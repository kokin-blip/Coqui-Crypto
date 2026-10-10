import { NewsStudyStatus } from './NewsPanels.js';
import type { CoquiClient } from '@coqui/contracts';

import { NegativeFindings } from './NegativeFindings.js';
import { ResearchRuns } from './ResearchRuns.js';
import { ResearchEvidenceDashboard } from './ResearchEvidenceDashboard.js';
import { SurfaceState } from './SurfaceState.js';
import { useChannel } from '../query/use-channel.js';

export function Research({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const integrity = useChannel(client,'research.integrity-workspace',{});
  const edgeStudy = useChannel(client, 'research.edge-study', {});
  return (
    <div className="screen-stack"><NewsStudyStatus client={client} />
      <section className="panel" aria-labelledby="forward-edge-heading">
        <div className="panel-heading"><div><h2 id="forward-edge-heading">Forward edge study</h2></div><span className="section-label">Prospective evidence only</span></div>
        {edgeStudy.kind === 'loading' && <SurfaceState kind="loading" title="Reading the registered study" compact />}
        {edgeStudy.kind === 'ready' && <>
          <p><strong>{edgeStudy.value.status.replaceAll('_', ' ')}</strong> · {edgeStudy.value.completedDays}/365 completed forward days · {edgeStudy.value.costBearingRebalances}/30 cost-bearing rebalances.</p>
          <p>{edgeStudy.value.eligibilityReasons.join(', ').replaceAll('_', ' ')}. Historical counts do not qualify the current executable.</p>
          <p>Registered strategy: {edgeStudy.value.strategyId ?? 'none'} · current: {edgeStudy.value.currentStrategyId}. Eligible observations: {edgeStudy.value.eligibleDays} / {edgeStudy.value.expectedDays} expected days.</p>
          <p className="muted">No historical backfill or parameter reselection. Registered trial upper bound: {edgeStudy.value.trialUpperBound}. Activation: {edgeStudy.value.activated ? 'integrity-verified passing result active' : 'none—execution edge remains zero'}.</p>
          {edgeStudy.value.grossEdgeLowerBoundPct !== null && <p>Gross lower bound {edgeStudy.value.grossEdgeLowerBoundPct.toFixed(3)}% · current costs applied once · net lower bound {edgeStudy.value.netEdgeLowerBoundPct?.toFixed(3) ?? 'unavailable'}%</p>}
          {edgeStudy.value.planHash !== null && <p className="mono muted">plan {edgeStudy.value.planHash.slice(0, 16)}… · costs {edgeStudy.value.costProfileHash?.slice(0, 16)}…{edgeStudy.value.resultHash === null ? '' : ` · result ${edgeStudy.value.resultHash.slice(0, 16)}… · ${edgeStudy.value.sourceHashes.length} source hashes`}</p>}
        </>}
        {edgeStudy.kind !== 'loading' && edgeStudy.kind !== 'ready' && <SurfaceState kind="error" title="Forward study unavailable" detail={edgeStudy.issues.map((issue) => issue.code).join(', ')} compact />}
      </section>
      <section className="panel"><h2>Governed experiments · read only</h2><p>Dataset → development → frozen candidate or none → holdout exposure → approved prospective coverage → evaluation. No transition commands are available here.</p>
        {integrity.kind !== 'ready' ? <SurfaceState compact kind={integrity.kind==='loading'?'loading':'error'} title="Experiment evidence unavailable" /> : integrity.value.studies.length===0 ? <p>No integrity study registered. Installation does not enroll a study.</p> : integrity.value.studies.map(s=><details key={s.planHash}><summary>{s.family} · development {s.developmentState} · candidate {s.candidateState} · holdout {s.holdoutState}</summary>
          <p className="mono">Plan {s.planHash} · source {s.codeRevision} · dataset {s.datasetHash} · lineage {s.dataLineage}</p>
          <p>Qualification {s.qualification.replaceAll('_',' ')} · prospective enrollment {s.prospectiveEnrollment.replaceAll('_',' ')}</p>
          <p>Freeze {s.freezeHash ?? 'none'} · candidate {s.candidateId ?? s.candidateState} · {s.candidateCount} planned candidates</p>
          <ul>{s.stages.map(stage=><li key={stage.kind}>{stage.kind.replaceAll('_',' ')}: {stage.count} events; last {new Date(stage.lastAtMs).toISOString()}</li>)}</ul>
          <p>{s.gates.join(' · ')}</p><p>Runtime {s.sourceManifestHash} · lockfile {s.lockfileHash} · costs {s.costHashes.join(', ')}</p>
        </details>)}
      </section>
      <ResearchRuns client={client} />
      <ResearchEvidenceDashboard client={client} />
      <NegativeFindings client={client} />
    </div>
  );
}
