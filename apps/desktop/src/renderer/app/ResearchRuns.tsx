import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

export function ResearchRuns({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const runs = useChannel(client, 'research.runs', {});

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
    </section>
  );
}
