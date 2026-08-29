import type { CoquiClient } from '@coqui/contracts';
import { Minus, Plus, X } from 'lucide-react';

import { useChannel } from '../query/use-channel.js';
import { useWorkspace } from './WorkspaceContext.js';

const BLOCK_REASON: Readonly<Record<string, string>> = {
  blocked_trial_history_incomplete: 'Historical trial evidence is incomplete.',
  blocked_no_verified_evidence: 'No verified evidence snapshot is available.',
  blocked_invalid_evidence: 'Stored evidence failed integrity verification.',
  blocked_unsupported_evidence: 'The evidence format is unsupported.',
  requirements_not_met: 'The registered evidence requirements are not met.',
  eligible_for_review: 'Evidence is eligible for human review.',
};

export function EvidenceInspector({ client }: { readonly client: CoquiClient }): React.JSX.Element {
  const workspace = useWorkspace();
  const gate = useChannel(client, 'risk.evidence-gate', {});
  const edge = useChannel(client, 'research.edge-study', {});
  const campaign = useChannel(client, 'paper.campaign', {});
  const width = workspace.preferences?.inspectorWidthPx ?? 320;

  return (
    <aside className="evidence-inspector" style={{ width }} aria-label="Evidence inspector">
      <header><div><p className="eyebrow">Context</p><h2>Evidence inspector</h2></div><div className="inspector-actions"><button type="button" aria-label="Narrow evidence inspector" disabled={width <= 280 || workspace.pending} onClick={() => void workspace.update({ inspectorWidthPx: Math.max(280, width - 40) })}><Minus size={15} /></button><button type="button" aria-label="Widen evidence inspector" disabled={width >= 420 || workspace.pending} onClick={() => void workspace.update({ inspectorWidthPx: Math.min(420, width + 40) })}><Plus size={15} /></button><button type="button" aria-label="Close evidence inspector" onClick={() => void workspace.update({ inspectorOpen: false })}><X size={16} /></button></div></header>
      <section><p className="section-label">Decision</p><h3>{gate.kind === 'ready' && gate.value.facts !== null ? gate.value.facts.leader : 'No eligible strategy'}</h3><span className="inspector-status">Not validated</span><p className="rail-negative">{gate.kind === 'ready' ? (BLOCK_REASON[gate.value.status] ?? gate.value.status.replaceAll('_', ' ')) : 'Evidence unavailable.'}</p></section>
      <section><p className="section-label">Prospective study</p>{edge.kind === 'ready' ? <dl><div><dt>State</dt><dd>{edge.value.status}</dd></div><div><dt>Observed days</dt><dd>{edge.value.completedDays} / {edge.value.minimumCompletedDays}</dd></div><div><dt>Cost-bearing events</dt><dd>{edge.value.costBearingRebalances} / {edge.value.minimumCostBearingRebalances}</dd></div></dl> : <p>Study status unavailable.</p>}</section>
      <section><p className="section-label">Campaign</p>{campaign.kind === 'ready' && campaign.value !== null ? <dl><div><dt>State</dt><dd>{campaign.value.state}</dd></div><div><dt>Observed</dt><dd>{campaign.value.observedDays} / {campaign.value.requiredDays} days</dd></div><div><dt>Safety stop</dt><dd>{campaign.value.killSwitchAcknowledged ? 'Exercised and acknowledged' : campaign.value.killSwitchExercised ? 'Awaiting acknowledgement' : 'Not yet exercised'}</dd></div><div><dt>Reconciliation</dt><dd>{campaign.value.reconciled ? 'Complete' : 'Pending'}</dd></div></dl> : <p>No eligible campaign day has been recorded.</p>}</section>
      <section><p className="section-label">Provenance</p>{gate.kind === 'ready' && gate.value.source !== null ? <dl><div><dt>Dataset</dt><dd>{gate.value.source.datasetHash.slice(0, 12)}…</dd></div><div><dt>Trial registry</dt><dd>{gate.value.source.trialRegistryHash.slice(0, 12)}…</dd></div><div><dt>Cost profile</dt><dd>{gate.value.source.costProfileHash.slice(0, 12)}…</dd></div></dl> : <p>No verified source hashes.</p>}</section>
    </aside>
  );
}
