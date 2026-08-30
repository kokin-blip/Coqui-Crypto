import type { CoquiClient } from '@coqui/contracts';

import { useChannel } from '../query/use-channel.js';

const BLOCK_REASON: Readonly<Record<string, string>> = {
  blocked_trial_history_incomplete: 'Historical trial evidence is incomplete.',
  blocked_no_verified_evidence: 'No registered positive net-edge estimate.',
  blocked_invalid_evidence: 'Stored evidence failed integrity verification.',
  blocked_unsupported_evidence: 'The evidence format is unsupported.',
  requirements_not_met: 'The registered evidence requirements are not met.',
  eligible_for_review: 'Evidence is eligible for human review.',
};

export function EvidenceStack({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const gate = useChannel(client, 'risk.evidence-gate', {});
  const edge = useChannel(client, 'research.edge-study', {});
  const campaign = useChannel(client, 'paper.campaign', {});
  const leader = gate.kind === 'ready' && gate.value.facts !== null ? gate.value.facts.leader : 'No verified leader';
  const reason = gate.kind === 'ready' ? (BLOCK_REASON[gate.value.status] ?? gate.value.status.replaceAll('_', ' ')) : 'Evidence unavailable.';

  return (
    <aside className="evidence-stack panel" aria-labelledby="evidence-stack-heading">
      <header><div><p className="eyebrow">Evidence stack</p><h2 id="evidence-stack-heading">Decision summary</h2></div><span className="status-chip warning">Review required</span></header>
      <section><span className="section-label">Leading strategy</span><strong>{leader}</strong><span className="validation-state"><i aria-hidden="true" /> Not validated</span></section>
      <section><span className="section-label">Blocking reason</span><strong className="rail-negative">{reason}</strong><p>Submission reruns profitability, evidence, risk, permission, and safety-stop checks.</p></section>
      <section><span className="section-label">Forward study</span>{edge.kind === 'ready' ? <dl><div><dt>Completed days</dt><dd>{edge.value.completedDays} / {edge.value.minimumCompletedDays}</dd></div><div><dt>Cost-bearing events</dt><dd>{edge.value.costBearingRebalances} / {edge.value.minimumCostBearingRebalances}</dd></div></dl> : <p>Study progress unavailable.</p>}</section>
      <section><span className="section-label">Campaign</span><p>{campaign.kind === 'ready' && campaign.value !== null ? `${campaign.value.observedDays} / ${campaign.value.requiredDays} days · ${campaign.value.state}` : 'Awaiting first eligible UTC day.'}</p></section>
      <section><span className="section-label">Provenance</span>{gate.kind === 'ready' && gate.value.source !== null ? <dl><div><dt>Dataset</dt><dd>{gate.value.source.datasetHash.slice(0, 12)}…</dd></div><div><dt>Cost profile</dt><dd>{gate.value.source.costProfileHash.slice(0, 12)}…</dd></div></dl> : <p>No verified source hashes.</p>}</section>
    </aside>
  );
}
