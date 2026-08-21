import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

/**
 * Boot shell.
 *
 * This is the vertical slice that proves the stack: a real channel read through
 * the query layer, rendering each designed state distinctly. The scoreboard
 * replaces it in Stage 4, once the wireframes are approved — UI-UX §0 forbids
 * propagating a visual language before that.
 */
export function App({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const runs = useChannel(client, 'research.runs', {});

  return (
    <main className="mx-auto max-w-3xl p-8 font-mono text-sm">
      <h1 className="mb-1 text-base font-semibold">Coqui</h1>
      <p className="mb-6 opacity-70">
        paper-trading research · no live order path exists in this build
      </p>

      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading" className="mb-2 font-semibold">
          Registered study runs
        </h2>

        {runs.kind === 'loading' && <p aria-live="polite">Loading…</p>}

        {runs.kind === 'ready' && runs.value.length === 0 && (
          <p>No study has been run against this profile yet.</p>
        )}

        {runs.kind === 'ready' && runs.value.length > 0 && (
          <ul className="space-y-1">
            {runs.value.map((run) => (
              <li key={run.runHash}>
                {run.id} · {run.adopted ? 'adopted' : 'not adopted'} ·{' '}
                <span className="opacity-70">dataset {run.datasetHash.slice(0, 8)}…</span>
              </li>
            ))}
          </ul>
        )}

        {/*
          Failure, blocked and unknown render distinctly. UI-UX §3.1 requires
          it, and collapsing them would tell a user that a guardrail refusal and
          a crashed provider are the same event.
        */}
        {runs.kind === 'failed' && (
          <p role="alert">Could not load runs: {runs.issues.map((i) => i.code).join(', ')}</p>
        )}
        {runs.kind === 'blocked' && (
          <p role="alert">Blocked: {runs.issues.map((i) => i.code).join(', ')}</p>
        )}
        {runs.kind === 'unknown' && (
          <p role="alert">
            Outcome unconfirmed: {runs.issues.map((i) => i.code).join(', ')}. Do not retry.
          </p>
        )}
      </section>
    </main>
  );
}
