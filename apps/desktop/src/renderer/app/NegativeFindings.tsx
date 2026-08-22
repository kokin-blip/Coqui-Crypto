import type { ChannelResponse, CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

type Finding = ChannelResponse<'research.negative-findings'>['findings'][number];

/**
 * The negative-findings panel (wireframe region 5).
 *
 * `docs/PLAN.md` P8: "A negative result here is a success. It is the single
 * most valuable thing this project can tell its owner." So this is a peer of
 * the evidence panel, not a buried page.
 *
 * The label is `NEGATIVE FINDINGS` rather than "ruled out" — the studies' own
 * status is *not adopted*, and several negatives are window-specific. Asserting
 * finality the evidence does not support is the overclaim this project exists
 * to avoid.
 */

const OUTCOME_LABELS: Readonly<Record<Finding['outcome'], string>> = {
  'not-adopted': 'not adopted',
  'no-edge': 'no edge',
};

function Row({ finding }: { readonly finding: Finding }): React.JSX.Element {
  const recorded = finding.source === 'predecessor-vault';
  return (
    <li className="border-b py-1 last:border-b-0">
      <div className="flex justify-between gap-4">
        <span>{finding.title}</span>
        <span className="shrink-0 opacity-80">{OUTCOME_LABELS[finding.outcome]}</span>
      </div>
      <p className="opacity-70">{finding.summary}</p>
      <p className="opacity-60">
        {finding.reference}
        {recorded && (
          <>
            {' · '}
            <span>recorded from the predecessor, not verifiable here</span>
          </>
        )}
      </p>
    </li>
  );
}

export function NegativeFindings({
  client,
}: {
  readonly client: CoquiClient;
}): React.JSX.Element {
  const ledger = useChannel(client, 'research.negative-findings', {});

  if (ledger.kind === 'loading') return <p aria-live="polite">Loading findings…</p>;
  if (ledger.kind !== 'ready') {
    return (
      <p role="alert">
        Could not load findings: {ledger.issues.map((issue) => issue.code).join(', ')}
      </p>
    );
  }

  const { findings, ledgerNote } = ledger.value;

  return (
    <section aria-labelledby="findings-heading" className="space-y-2">
      <h3 id="findings-heading" className="font-semibold">
        NEGATIVE FINDINGS ({findings.length})
      </h3>
      <p className="opacity-70">
        Ideas that were tested and did not earn a place in the defaults. Each one is a
        result, not a gap.
      </p>

      <ul>
        {findings.map((finding) => (
          <Row key={finding.id} finding={finding} />
        ))}
      </ul>

      {/* The predecessor's own two enumerations disagree; saying so is cheaper
          than silently dropping or merging an entry. */}
      <p className="opacity-60">{ledgerNote}</p>
    </section>
  );
}
