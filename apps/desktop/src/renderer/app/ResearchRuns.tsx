import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

export function ResearchRuns({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const runs = useChannel(client, 'research.runs', {});
  const lineage = useChannel(client, 'research.lineage', { limit: 50 });

  return (
    <section aria-labelledby="runs-heading" className="panel space-y-3">
      <div className="panel-heading">
        <div><p className="eyebrow">Immutable evidence</p><h2 id="runs-heading">Registered study runs</h2></div>
      </div>

      {runs.kind === 'loading' && <p aria-live="polite">Loading registered runs…</p>}
      {runs.kind === 'ready' && runs.value.length === 0 && (
        <p className="empty-state">No study has been run against this profile yet.</p>
      )}
      {runs.kind === 'ready' && runs.value.length > 0 && (
        <ul className="evidence-list">
          {runs.value.map((run) => (
            <li key={run.runHash}>
              <span><strong>{run.id}</strong> · {run.adopted ? 'adopted' : 'not adopted'}</span>
              <span className="muted">dataset {run.datasetHash.slice(0, 12)}…</span>
            </li>
          ))}
        </ul>
      )}
      {runs.kind !== 'loading' && runs.kind !== 'ready' && (
        <p role="alert">
          {runs.kind === 'blocked' ? 'Blocked' : runs.kind === 'unknown' ? 'Outcome unconfirmed' : 'Could not load runs'}:{' '}
          {runs.issues.map((issue) => issue.code).join(', ')}
        </p>
      )}
      <div className="lineage-heading"><h3>Champion and challenger lineage</h3>
        <span>{lineage.kind === 'ready' ? `as of ${new Date(lineage.value.asOfMs).toISOString().slice(0, 10)} · global` : 'Persisted evidence only'}</span></div>
      {lineage.kind === 'loading' && <p aria-live="polite">Reading immutable lineage…</p>}
      {lineage.kind === 'ready' && lineage.value.candidates.length === 0 &&
        <p className="empty-state">No champion or challenger candidate has been recorded.</p>}
      {lineage.kind === 'ready' && lineage.value.candidates.length > 0 && <ol className="lineage-list">
        {lineage.value.candidates.map((candidate) => <li key={candidate.candidateId} data-active={candidate.active || undefined}>
          <div><strong>{candidate.strategyVersion}</strong><span>{candidate.active ? 'active champion' : candidate.state.replaceAll('_', ' ')}</span></div>
          <p>{candidate.parentId === null ? 'Root candidate' : `Child of ${candidate.parentId.slice(0, 10)}…`}</p>
          <small>evidence {candidate.evidenceHash.slice(0, 12)}… · {new Date(candidate.createdAtMs).toISOString()}</small>
        </li>)}
      </ol>}
      {lineage.kind !== 'loading' && lineage.kind !== 'ready' &&
        <p role="alert">Lineage unavailable: {lineage.issues.map((issue) => issue.code).join(', ')}</p>}
    </section>
  );
}
