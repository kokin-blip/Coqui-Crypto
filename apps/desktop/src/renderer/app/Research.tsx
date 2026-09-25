import type { CoquiClient } from '@coqui/contracts';

import { NegativeFindings } from './NegativeFindings.js';
import { ResearchRuns } from './ResearchRuns.js';
import { ResearchEvidenceDashboard } from './ResearchEvidenceDashboard.js';
import { SurfaceState } from './SurfaceState.js';
import { useChannel } from '../query/use-channel.js';

export function Research({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const edgeStudy = useChannel(client, 'research.edge-study', {});
  return (
    <div className="screen-stack">
      <section className="panel" aria-labelledby="forward-edge-heading">
        <div className="panel-heading"><div><h2 id="forward-edge-heading">Forward edge study</h2></div><span className="section-label">Prospective evidence only</span></div>
        {edgeStudy.kind === 'loading' && <SurfaceState kind="loading" title="Reading the registered study" compact />}
        {edgeStudy.kind === 'ready' && <>
          <p><strong>{edgeStudy.value.status.replaceAll('_', ' ')}</strong> · {edgeStudy.value.completedDays}/365 completed forward days · {edgeStudy.value.costBearingRebalances}/30 cost-bearing rebalances.</p>
          <p className="muted">No historical backfill or parameter reselection. Registered trial upper bound: {edgeStudy.value.trialUpperBound}. Activation: {edgeStudy.value.activated ? 'integrity-verified passing result active' : 'none—execution edge remains zero'}.</p>
          {edgeStudy.value.grossEdgeLowerBoundPct !== null && <p>Gross lower bound {edgeStudy.value.grossEdgeLowerBoundPct.toFixed(3)}% · current costs applied once · net lower bound {edgeStudy.value.netEdgeLowerBoundPct?.toFixed(3) ?? 'unavailable'}%</p>}
          {edgeStudy.value.planHash !== null && <p className="mono muted">plan {edgeStudy.value.planHash.slice(0, 16)}… · costs {edgeStudy.value.costProfileHash?.slice(0, 16)}…{edgeStudy.value.resultHash === null ? '' : ` · result ${edgeStudy.value.resultHash.slice(0, 16)}… · ${edgeStudy.value.sourceHashes.length} source hashes`}</p>}
        </>}
        {edgeStudy.kind !== 'loading' && edgeStudy.kind !== 'ready' && <SurfaceState kind="error" title="Forward study unavailable" detail={edgeStudy.issues.map((issue) => issue.code).join(', ')} compact />}
      </section>
      <ResearchRuns client={client} />
      <ResearchEvidenceDashboard client={client} />
      <NegativeFindings client={client} />
    </div>
  );
}
